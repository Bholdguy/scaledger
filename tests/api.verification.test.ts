import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/server/app.js';
import { closeDb, getDb } from '../src/server/db.js';

/**
 * GET /api/verification?mint= — confirms the real STRCx fixture's source facts (the tx
 * signature, dividend, source_mode) come through the HTTP layer inline, not just the
 * export. This is the endpoint the detail panel actually calls. See PRD.md Step 6.
 */
describe('GET /api/verification (real STRCx fixture)', () => {
  let app: ReturnType<typeof createApp>;
  const mint = 'Xs78JED6PFZxWc2wCEPspZW9kL3Se5J7L5TChKgsidH';

  beforeEach(() => {
    process.env.DATABASE_URL = ':memory:';
    getDb();
    app = createApp();
  });

  afterEach(() => {
    closeDb();
  });

  it('returns the real tx_signature, dividend, and source_mode inline after a demo run', async () => {
    const runRes = await request(app).post(`/api/verification/run?mint=${mint}&mode=demo`);
    expect(runRes.status).toBe(200);

    const res = await request(app).get(`/api/verification?mint=${mint}`);
    expect(res.status).toBe(200);
    expect(res.body.txSignature).toBe(
      '5SNeWC8YzL7rEHYKmmgYrradpYgTboBRY6WdrH4Z8xwHuK2q4zRd2AthjDtKjYc7vf7vFGxYFA3vGZ69Rg6XDjsm',
    );
    expect(res.body.effectiveTimestamp).toBe('2026-08-30T23:55:00.000Z');
    expect(res.body.dividendSize).toBe(0.5);
    expect(res.body.priorClosePrice).toBeCloseTo(97.33000183105469, 6);
    // FixtureSource labels its own source as 'fixture' (see dataSource.ts) — the original
    // manual-sourcing label ('strategy_press_release_and_dividend_history') is what
    // CorporateActionReferenceService.fetch would return on the live path instead.
    expect(res.body.source).toBe('fixture');
    expect(res.body.sourceMode).toBe('manual');
    expect(res.body.sourceUrl).toBe('https://stockanalysis.com/stocks/strc/dividend/');
    expect(res.body.status).toBe('discrepancy_flagged');
  });
});
