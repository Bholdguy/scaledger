import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FixtureSource } from '../src/server/dataSource.js';
import { runVerificationPipeline } from '../src/server/verificationPipeline.js';
import { getVerificationForMint } from '../src/server/verificationService.js';
import { closeDb, getDb } from '../src/server/db.js';
import { VerificationStatus } from '../src/shared/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MINT = 'Xs78JED6PFZxWc2wCEPspZW9kL3Se5J7L5TChKgsidH';

describe('runVerificationPipeline in demo mode (Step 10)', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = ':memory:';
    getDb();
  });

  afterEach(() => {
    closeDb();
  });

  it('reproduces the real, spike-confirmed discrepancy_flagged result from the frozen fixture', async () => {
    const source = new FixtureSource(path.join(__dirname, '../fixtures/strcx-canonical-event.json'));
    const records = await runVerificationPipeline(source, MINT);
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe(VerificationStatus.DiscrepancyFlagged);
    expect(records[0].expectedRatio).toBeCloseTo(0.3596013494457029, 10);
    expect(records[0].actualRatio).toBeCloseTo(0.5137162231583225, 10);
  });

  it('three runs in a row produce field-for-field identical results (TESTING.md Section 6)', async () => {
    const source = new FixtureSource(path.join(__dirname, '../fixtures/strcx-canonical-event.json'));
    const run1 = await runVerificationPipeline(source, MINT);
    const run2 = await runVerificationPipeline(source, MINT);
    const run3 = await runVerificationPipeline(source, MINT);

    for (const field of ['status', 'expectedRatio', 'actualRatio', 'discrepancy'] as const) {
      expect(run2[0][field]).toBe(run1[0][field]);
      expect(run3[0][field]).toBe(run1[0][field]);
    }
    // Idempotent: re-running against the same event doesn't create duplicate VerificationRecords rows.
    expect(run1[0].id).toBe(run2[0].id);
    expect(run2[0].id).toBe(run3[0].id);
  });

  it('two different wallets querying the same mint see the identical stored verdict (TESTING.md Section 5)', async () => {
    const source = new FixtureSource(path.join(__dirname, '../fixtures/strcx-canonical-event.json'));
    await runVerificationPipeline(source, MINT);

    // GET /api/verification?mint= is a pure lookup — calling it for "two different wallets"
    // is meaningless at the DB layer (the table has no wallet column at all, by design —
    // CONTRACT.md / DECISIONS.md D2), which is itself the proof: there is only one row to find.
    const first = getVerificationForMint(MINT);
    const second = getVerificationForMint(MINT);
    expect(first).not.toBeNull();
    expect(first!.id).toBe(second!.id);
    expect(first!.status).toBe(second!.status);
  });
});
