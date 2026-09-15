import { getDb } from './db.js';
import { randomUUID } from 'node:crypto';

export interface CorporateActionReference {
  id: string;
  ticker: string;
  actionType: 'dividend' | 'split' | 'reverse_split';
  size: number;
  priorClosePrice: number;
  source: string;
  sourceMode: 'live' | 'manual';
  sourceUrl: string;
  effectiveDate: string;
}

/**
 * Manually-sourced references, checked into the repo per PRD.md Step 4's fallback design.
 * Per DECISIONS.md D9: the xStocks public API's corporate-actions endpoint returned
 * `{"error":"Internal server error","message":"Unauthenticated"}` when queried directly
 * during the implementation-time spike (2026-09-14) — despite being documented as a
 * no-auth public endpoint (DECISIONS.md D4). The live path is attempted first below and
 * always falls through to this table on failure, per the 2-hour time-box; this table's
 * one entry is what that fallback actually produced for the canonical STRCx event.
 */
const MANUAL_REFERENCES: CorporateActionReference[] = [
  {
    id: 'strcx-2026-08-31-dividend',
    ticker: 'STRCx',
    actionType: 'dividend',
    size: 0.5, // gross $/share, 12.00% p.a. semi-monthly, period ending 2026-08-31
    priorClosePrice: 97.33000183105469, // STRC close 2026-08-28 (last trading day before the weekend rebase)
    source: 'strategy_press_release_and_dividend_history',
    sourceMode: 'manual',
    sourceUrl: 'https://stockanalysis.com/stocks/strc/dividend/',
    effectiveDate: '2026-08-31',
  },
];

async function tryLiveFetch(
  ticker: string,
  date: string,
): Promise<CorporateActionReference | null> {
  const baseUrl = process.env.XSTOCKS_API_BASE_URL;
  if (!baseUrl) return null;
  try {
    const res = await fetch(`${baseUrl}/api/v1/corporate-actions?ticker=${ticker}&date=${date}`, {
      headers: process.env.XSTOCKS_API_KEY ? { 'X-Api-Key': process.env.XSTOCKS_API_KEY } : {},
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      size: number;
      priorClosePrice: number;
      source: string;
      sourceUrl: string;
      actionType: CorporateActionReference['actionType'];
    };
    return {
      id: randomUUID(),
      ticker,
      actionType: body.actionType,
      size: body.size,
      priorClosePrice: body.priorClosePrice,
      source: body.source,
      sourceMode: 'live',
      sourceUrl: body.sourceUrl,
      effectiveDate: date,
    };
  } catch {
    return null;
  }
}

/**
 * Step 4 (Fetch). Tries the live xStocks endpoint first; falls back to the manually-sourced
 * table on any failure (network error, non-2xx, or no base URL configured) — never a silent
 * placeholder. `source_mode` is always populated and always disclosed. See CONTRACT.md.
 */
export async function fetchCorporateActionReference(
  ticker: string,
  date: string,
): Promise<CorporateActionReference | null> {
  const live = await tryLiveFetch(ticker, date);
  if (live) return live;

  // Manual fallback matches by ticker + nearest effective_date to the requested rebase
  // date, not exact equality: a rebase's on-chain effective_timestamp (e.g. the Aug 30
  // multiplier update) commonly lands a day or two before the dividend record/ex-date it
  // corresponds to (e.g. 2026-08-31) — see DECISIONS.md D9. With one manual reference per
  // ticker in this hackathon-scope table, "nearest" is sufficient; a real multi-event
  // deployment would need the live API's own date-range semantics instead.
  const candidates = MANUAL_REFERENCES.filter((r) => r.ticker === ticker);
  if (candidates.length === 0) return null;
  const target = new Date(date).getTime();
  candidates.sort(
    (a, b) =>
      Math.abs(new Date(a.effectiveDate).getTime() - target) -
      Math.abs(new Date(b.effectiveDate).getTime() - target),
  );
  return candidates[0];
}

export function recordCorporateActionReference(ref: CorporateActionReference): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO CorporateActionReferences (id, ticker, action_type, size, prior_close_price, source, source_mode, source_url, effective_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  ).run(
    ref.id,
    ref.ticker,
    ref.actionType,
    ref.size,
    ref.priorClosePrice,
    ref.source,
    ref.sourceMode,
    ref.sourceUrl,
    ref.effectiveDate,
  );
}
