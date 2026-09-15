import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/server/app.js';
import { closeDb, getDb } from '../src/server/db.js';

/**
 * Step 8 (TESTING.md): export the STRCx record and assert the CSV/JSON contains the exact
 * expected/actual numbers, both source URLs, both timestamps, and the status — parseable
 * and complete, checked by re-parsing the exported file in the test.
 */
describe('GET /api/verification/:id/export', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    process.env.DATABASE_URL = ':memory:';
    getDb();
    app = createApp();
  });

  afterEach(() => {
    closeDb();
  });

  it('exports a complete, re-parseable record in both formats after a demo run', async () => {
    const mint = 'Xs78JED6PFZxWc2wCEPspZW9kL3Se5J7L5TChKgsidH';
    const runRes = await request(app).post(`/api/verification/run?mint=${mint}&mode=demo`);
    expect(runRes.status).toBe(200);
    const id = runRes.body.records[0].id;

    const jsonRes = await request(app).get(`/api/verification/${id}/export?format=json`);
    expect(jsonRes.status).toBe(200);
    const json = jsonRes.body;
    expect(json.status).toBe('discrepancy_flagged');
    expect(json.expected_ratio).toBeCloseTo(0.3596013494457029, 10);
    expect(json.actual_ratio).toBeCloseTo(0.5137162231583225, 10);
    expect(json.source_url).toBeTruthy();
    expect(json.tx_signature).toBeTruthy();
    expect(json.effective_timestamp).toBeTruthy();
    expect(json.computed_at).toBeTruthy();
    expect(json.tolerance_used).toBe(0.01);

    const csvRes = await request(app).get(`/api/verification/${id}/export?format=csv`);
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers['content-type']).toContain('text/csv');
    const lines = csvRes.text.trim().split('\n');
    expect(lines).toHaveLength(2);
    const headers = lines[0].split(',');
    const values = lines[1].split(',');
    const row = Object.fromEntries(headers.map((h, i) => [h, values[i]]));
    expect(row.status).toBe('discrepancy_flagged');
    expect(Number(row.expected_ratio)).toBeCloseTo(0.3596013494457029, 8);
    expect(Number(row.actual_ratio)).toBeCloseTo(0.5137162231583225, 8);
    expect(row.source_url).toBeTruthy();
    expect(row.tolerance_used).toBe('0.01');
  });

  it('404s on an unknown record id rather than returning an empty/partial export', async () => {
    const res = await request(app).get('/api/verification/does-not-exist/export?format=json');
    expect(res.status).toBe(404);
  });
});
