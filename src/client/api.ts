/**
 * Relative — same-origin in production (Express serves the built frontend and the API
 * from one deployed service) and proxied to the API server in dev (see vite.config.ts).
 */
export const API_BASE = '';

export interface Holding {
  mint: string;
  ticker: string;
  balance: number;
  lastChecked: string;
  disclosure: { ticker: string; tagText: string; sourceUrl: string } | null;
}

export interface VerificationRecord {
  id: string;
  rebaseEventId: string;
  corporateActionReferenceId: string | null;
  expectedRatio: number | null;
  actualRatio: number;
  discrepancy: number | null;
  status: 'verified' | 'discrepancy_flagged' | 'reference_unavailable';
  toleranceUsed: number;
  computedAt: string;
}

export interface ImpactResponse {
  wallet: string;
  mint: string;
  verificationRecordId: string;
  status: string;
  balance: number;
  derived: true;
  personalExpectedChange: number | null;
  personalActualChange: number;
}

export interface HistoryRow {
  id: string;
  mint: string;
  status: string;
  expected_ratio: number | null;
  actual_ratio: number;
  discrepancy: number | null;
  effective_timestamp: string;
  computed_at: string;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function fetchHoldings(wallet: string): Promise<{ wallet: string; holdings: Holding[] }> {
  return getJson(`/api/holdings?wallet=${encodeURIComponent(wallet)}`);
}

export function runVerification(mint: string, mode?: 'demo' | 'live'): Promise<{ records: VerificationRecord[] }> {
  const modeParam = mode ? `&mode=${mode}` : '';
  return fetch(`${API_BASE}/api/verification/run?mint=${encodeURIComponent(mint)}${modeParam}`, {
    method: 'POST',
  }).then(async (res) => {
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error ?? `request failed: ${res.status}`);
    }
    return res.json();
  });
}

export function fetchVerification(mint: string): Promise<VerificationRecord> {
  return getJson(`/api/verification?mint=${encodeURIComponent(mint)}`);
}

export function fetchImpact(wallet: string, mint: string): Promise<ImpactResponse> {
  return getJson(`/api/holdings/${encodeURIComponent(wallet)}/${encodeURIComponent(mint)}/impact`);
}

export function fetchHistory(wallet: string): Promise<{ wallet: string; history: HistoryRow[] }> {
  return getJson(`/api/verification/history?wallet=${encodeURIComponent(wallet)}`);
}

export function exportUrl(id: string, format: 'csv' | 'json'): string {
  return `${API_BASE}/api/verification/${encodeURIComponent(id)}/export?format=${format}`;
}
