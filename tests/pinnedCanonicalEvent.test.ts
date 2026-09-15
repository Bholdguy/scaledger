import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { computeExpectedRatio, computeActualRatio } from '../src/shared/ratios.js';
import { computeStatus, VerificationStatus } from '../src/shared/types.js';
import type { CorporateActionReference } from '../src/server/corporateActionReferenceService.js';
import type { RebaseEvent } from '../src/server/rebaseDetectionService.js';

/**
 * Step 5's load-bearing pinned regression test (TESTING.md Section 4). The fixture was
 * frozen from the real implementation-time spike against live data (DECISIONS.md D9) —
 * exact-value assertions, not approximate. If this starts failing after a refactor, the
 * refactor changed real verification math, not a coincidental detail.
 */
interface Fixture {
  tx_signature: string;
  old_multiplier: number;
  new_multiplier: number;
  dividend_size: number;
  prior_close_price: number;
  expected_ratio: number;
  actual_ratio: number;
  discrepancy: number;
  tolerance_used: number;
  status: string;
}

const fixture: Fixture = JSON.parse(
  readFileSync(new URL('../fixtures/strcx-canonical-event.json', import.meta.url), 'utf8'),
);

describe('pinned STRCx canonical event regression (DECISIONS.md D9)', () => {
  const reference: CorporateActionReference = {
    id: 'fixture',
    ticker: 'STRCx',
    actionType: 'dividend',
    size: fixture.dividend_size,
    priorClosePrice: fixture.prior_close_price,
    source: 'fixture',
    sourceMode: 'manual',
    sourceUrl: 'fixture',
    effectiveDate: '2026-08-31',
  };
  const event: RebaseEvent = {
    id: 'fixture',
    mint: 'Xs78JED6PFZxWc2wCEPspZW9kL3Se5J7L5TChKgsidH',
    txSignature: 'fixture',
    oldMultiplier: fixture.old_multiplier,
    newMultiplier: fixture.new_multiplier,
    effectiveTimestamp: '2026-08-30T23:55:00.000Z',
  };

  it('reproduces the pinned expected_ratio exactly (within floating-point epsilon)', () => {
    expect(computeExpectedRatio(reference)).toBeCloseTo(fixture.expected_ratio, 10);
  });

  it('reproduces the pinned actual_ratio exactly (within floating-point epsilon)', () => {
    expect(computeActualRatio(event)).toBeCloseTo(fixture.actual_ratio, 10);
  });

  it('reproduces the pinned discrepancy exactly', () => {
    const discrepancy = Math.abs(computeExpectedRatio(reference) - computeActualRatio(event));
    expect(discrepancy).toBeCloseTo(fixture.discrepancy, 10);
  });

  it('reproduces the pinned status: discrepancy_flagged, not verified', () => {
    const status = computeStatus(
      computeExpectedRatio(reference),
      computeActualRatio(event),
      fixture.tolerance_used,
    );
    expect(status).toBe(VerificationStatus.DiscrepancyFlagged);
    expect(fixture.status).toBe('discrepancy_flagged');
  });

  it('carries a real, on-chain tx_signature — no placeholder remaining (DECISIONS.md D10)', () => {
    expect(fixture.tx_signature).toBe(
      '5SNeWC8YzL7rEHYKmmgYrradpYgTboBRY6WdrH4Z8xwHuK2q4zRd2AthjDtKjYc7vf7vFGxYFA3vGZ69Rg6XDjsm',
    );
    expect(fixture.tx_signature).not.toContain('PENDING');
    expect(fixture.tx_signature.length).toBeGreaterThan(80); // real base58 signatures are 87-88 chars
  });
});
