import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { computeAndRecordVerification, getVerificationForMint } from '../src/server/verificationService.js';
import { closeDb, getDb } from '../src/server/db.js';
import { VerificationStatus } from '../src/shared/types.js';
import { recordRebaseEvent, type RebaseEvent } from '../src/server/rebaseDetectionService.js';
import {
  recordCorporateActionReference,
  type CorporateActionReference,
} from '../src/server/corporateActionReferenceService.js';

/**
 * Step 6 (TESTING.md): synthetic fixtures covering all three VerificationStatus outcomes,
 * independent of which one STRCx's real event happens to land on (that's covered
 * separately by tests/pinnedCanonicalEvent.test.ts and verificationPipeline.demo.test.ts).
 */
describe('computeAndRecordVerification — all three outcomes', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = ':memory:';
    getDb();
  });

  afterEach(() => {
    closeDb();
  });

  function fakeEvent(id: string, mint: string, oldM: number, newM: number): RebaseEvent {
    const event: RebaseEvent = {
      id,
      mint,
      txSignature: `sig-${id}`,
      oldMultiplier: oldM,
      newMultiplier: newM,
      effectiveTimestamp: '2026-01-01T00:00:00.000Z',
    };
    recordRebaseEvent(event);
    return event;
  }

  function fakeReference(id: string, size: number, priorClose: number): CorporateActionReference {
    const reference: CorporateActionReference = {
      id,
      ticker: 'SYN',
      actionType: 'dividend',
      size,
      priorClosePrice: priorClose,
      source: 'synthetic',
      sourceMode: 'manual',
      sourceUrl: 'https://example.test/synthetic',
      effectiveDate: '2026-01-01',
    };
    recordCorporateActionReference(reference);
    return reference;
  }

  it('synthetic exact match -> verified', () => {
    // net dividend after 30% withholding / priorClose must equal the actual ratio exactly.
    const event = fakeEvent('e-verified', 'mint-verified', 1.0, 1.01); // actual = 1.0%
    const reference = fakeReference('r-verified', 1.0 / 0.7, 100); // net=1.0, /100 = 1.0%
    const record = computeAndRecordVerification(event, reference);
    expect(record.status).toBe(VerificationStatus.Verified);
  });

  it('synthetic large mismatch -> discrepancy_flagged', () => {
    const event = fakeEvent('e-flagged', 'mint-flagged', 1.0, 1.05); // actual = 5%
    const reference = fakeReference('r-flagged', 0.5, 100); // net=0.35, /100 = 0.35%
    const record = computeAndRecordVerification(event, reference);
    expect(record.status).toBe(VerificationStatus.DiscrepancyFlagged);
    expect(record.expectedRatio).not.toBeNull();
    expect(record.discrepancy).not.toBeNull();
  });

  it('synthetic no reference -> reference_unavailable, never a placeholder verdict', () => {
    const event = fakeEvent('e-unavail', 'mint-unavail', 1.0, 1.05);
    const record = computeAndRecordVerification(event, null);
    expect(record.status).toBe(VerificationStatus.ReferenceUnavailable);
    expect(record.expectedRatio).toBeNull();
    expect(record.corporateActionReferenceId).toBeNull();
  });

  it('the shared, once-computed lookup returns the same row for repeated lookups (proxy for "two wallets, one verdict")', () => {
    const event = fakeEvent('e-shared', 'mint-shared', 1.0, 1.02);
    const reference = fakeReference('r-shared', 1.4, 100);
    const first = computeAndRecordVerification(event, reference);
    const second = computeAndRecordVerification(event, reference); // re-run, should not duplicate
    expect(first.id).toBe(second.id);

    const lookedUp = getVerificationForMint('mint-shared');
    expect(lookedUp?.id).toBe(first.id);
  });
});
