import {
  fetchHoldings,
  runVerification,
  fetchVerification,
  fetchImpact,
  fetchHistory,
  exportUrl,
  type Holding,
  type VerificationRecord,
  type ImpactResponse,
} from './api.js';

const STRCX_MINT = 'Xs78JED6PFZxWc2wCEPspZW9kL3Se5J7L5TChKgsidH';

const app = document.getElementById('app')!;

let currentWallet: string | null = null;

function render(): void {
  app.innerHTML = `
    <h1>Scaledger</h1>
    <p class="subtitle">Independent, on-chain verification for tokenized-stock rebases — not another balance dashboard.</p>
    <div class="row">
      <input id="wallet-input" placeholder="Paste a Solana wallet address (or connect Phantom)" value="${currentWallet ?? ''}" />
      <button id="load-btn">Load holdings</button>
      <button id="connect-btn" class="secondary">Connect Phantom</button>
      <button id="check-btn" class="secondary">Run Live Check</button>
      <button id="demo-btn" class="secondary">Run Demo</button>
    </div>
    <div id="demo-banner"></div>
    <div id="holdings" class="card" style="display:none"></div>
    <div id="ledger-card" class="card" style="display:none">
      <strong>Verification history</strong>
      <div id="ledger"></div>
    </div>
    <div id="error" class="error"></div>
  `;

  document.getElementById('load-btn')!.addEventListener('click', () => {
    const val = (document.getElementById('wallet-input') as HTMLInputElement).value.trim();
    if (val) loadWallet(val);
  });
  document.getElementById('connect-btn')!.addEventListener('click', connectPhantom);
  document.getElementById('check-btn')!.addEventListener('click', runLiveCheck);
  document.getElementById('demo-btn')!.addEventListener('click', runDemo);
}

async function runLiveCheck(): Promise<void> {
  clearError();
  const banner = document.getElementById('demo-banner')!;
  banner.innerHTML = '<div class="demo-banner">Running a live check against Solana mainnet — this scans real transaction history and can be slow or rate-limited on public RPC (see DECISIONS.md D10).</div>';
  try {
    await runVerification(STRCX_MINT, 'live');
    banner.innerHTML = '';
    if (currentWallet) await loadWallet(currentWallet);
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
  }
}

async function connectPhantom(): Promise<void> {
  const provider = (window as any).solana;
  if (!provider?.isPhantom) {
    showError('Phantom wallet not detected. Paste a wallet address instead, or install Phantom.');
    return;
  }
  try {
    const resp = await provider.connect();
    const address: string = resp.publicKey.toString();
    (document.getElementById('wallet-input') as HTMLInputElement).value = address;
    await loadWallet(address);
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
  }
}

async function loadWallet(wallet: string): Promise<void> {
  clearError();
  currentWallet = wallet;
  const holdingsEl = document.getElementById('holdings')!;
  holdingsEl.style.display = 'block';
  holdingsEl.innerHTML = '<span class="muted">Loading holdings from live Solana RPC…</span>';
  try {
    const { holdings } = await fetchHoldings(wallet);
    renderHoldings(holdings, wallet);
    await loadLedger(wallet);
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
    holdingsEl.style.display = 'none';
  }
}

function renderHoldings(holdings: Holding[], wallet: string): void {
  const holdingsEl = document.getElementById('holdings')!;
  if (holdings.length === 0) {
    holdingsEl.innerHTML = '<span class="muted">No allowlisted tokenized-stock holdings found for this wallet.</span>';
    return;
  }
  holdingsEl.innerHTML = holdings
    .map(
      (h, i) => `
      <div class="holding">
        <div>
          <div class="ticker">${h.ticker}</div>
          <div class="balance">${h.balance.toLocaleString(undefined, { maximumFractionDigits: 6 })} · last checked ${new Date(h.lastChecked).toLocaleTimeString()}</div>
          ${h.disclosure ? `<div class="disclosure">${h.disclosure.tagText} <a href="${h.disclosure.sourceUrl}" target="_blank" rel="noopener">source</a></div>` : ''}
        </div>
        <div>
          <span class="badge reference_unavailable" id="badge-${i}" data-mint="${h.mint}" data-wallet="${wallet}">Check status</span>
        </div>
      </div>
      <div id="panel-${i}" class="detail-panel" style="display:none"></div>
    `,
    )
    .join('');

  holdings.forEach((h, i) => {
    const badge = document.getElementById(`badge-${i}`)!;
    badge.addEventListener('click', () => toggleDetail(i, h.mint, wallet));
    // Auto-load status without requiring a click, so the badge reflects reality immediately.
    loadBadge(i, h.mint);
  });
}

async function loadBadge(index: number, mint: string): Promise<void> {
  const badge = document.getElementById(`badge-${index}`)!;
  try {
    const record = await fetchVerification(mint);
    applyBadge(badge, record.status);
  } catch {
    badge.textContent = 'Not yet checked';
    badge.className = 'badge reference_unavailable';
  }
}

const STATUS_LABELS: Record<string, string> = {
  verified: 'Verified',
  discrepancy_flagged: 'Discrepancy Flagged',
  reference_unavailable: 'Reference Unavailable',
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/** UTC-explicit date formatting — on-chain effective timestamps must read the same
 * regardless of the viewer's local timezone (a viewer east of UTC could otherwise see
 * the Aug 30 event's late-night UTC timestamp roll over to Aug 31). */
function formatUtcDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });
}

function applyBadge(badge: HTMLElement, status: string): void {
  badge.textContent = statusLabel(status);
  badge.className = `badge ${status}`;
}

async function toggleDetail(index: number, mint: string, wallet: string): Promise<void> {
  const panel = document.getElementById(`panel-${index}`)!;
  if (panel.style.display === 'block') {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = 'block';
  panel.innerHTML = '<span class="muted">Loading…</span>';
  try {
    const record = await fetchVerification(mint);
    let impact: ImpactResponse | null = null;
    try {
      impact = await fetchImpact(wallet, mint);
    } catch {
      // wallet may not hold this mint in Holdings yet — impact is optional display detail
    }
    panel.innerHTML = renderDetailPanel(record, impact);
  } catch (err) {
    panel.innerHTML = `<span class="muted">No verification record yet for this mint — try "Run Demo" or run a live check.</span>`;
  }
}

function renderDetailPanel(record: VerificationRecord, impact: ImpactResponse | null): string {
  const expected =
    record.expectedRatio === null
      ? '<span class="muted">unavailable</span>'
      : `${record.expectedRatio.toFixed(6)}%`;
  const actual = `${record.actualRatio.toFixed(6)}%`;

  let html = `
    <div class="fact">
      <div class="fact-label">Fact (a) — expected multiplier ratio</div>
      <div class="fact-value">${expected}</div>
    </div>
    <div class="fact">
      <div class="fact-label">Fact (b) — actual on-chain multiplier ratio</div>
      <div class="fact-value">${actual}</div>
    </div>
    <div class="fact">
      <div class="fact-label">Discrepancy</div>
      <div class="fact-value">${record.discrepancy === null ? '—' : record.discrepancy.toFixed(6) + 'pp'} (tolerance ${record.toleranceUsed}pp)</div>
    </div>
  `;

  if (impact) {
    const expectedChange =
      impact.personalExpectedChange === null ? '—' : impact.personalExpectedChange.toFixed(6);
    html += `
      <div class="derived-line">
        <div class="fact-label">Your balance's derived impact</div>
        <div class="fact-value">expected +${expectedChange} · actual +${impact.personalActualChange.toFixed(6)} (balance ${impact.balance.toLocaleString()})</div>
      </div>
    `;
  }

  html += `
    <div class="row" style="margin-top:12px">
      <a href="${exportUrl(record.id, 'csv')}" target="_blank"><button class="secondary">Export CSV</button></a>
      <a href="${exportUrl(record.id, 'json')}" target="_blank"><button class="secondary">Export JSON</button></a>
    </div>
  `;
  return html;
}

async function runDemo(): Promise<void> {
  clearError();
  const wallet = currentWallet ?? (document.getElementById('wallet-input') as HTMLInputElement).value.trim();
  const banner = document.getElementById('demo-banner')!;
  banner.innerHTML = '<div class="demo-banner">Running demo — frozen fixture of real STRCx history…</div>';
  try {
    await runVerification(STRCX_MINT, 'demo');
    banner.innerHTML =
      '<div class="demo-banner">Demo data — frozen fixture of real STRCx history (Aug 30, 2026 rebase). Not a live claim.</div>';
    if (wallet) {
      await loadWallet(wallet);
    } else {
      const record = await fetchVerification(STRCX_MINT);
      const holdingsEl = document.getElementById('holdings')!;
      holdingsEl.style.display = 'block';
      holdingsEl.innerHTML = `
        <div class="holding">
          <div><div class="ticker">STRCx</div><div class="balance">Demo mode — no wallet loaded</div></div>
          <div><span class="badge ${record.status}" id="demo-badge"></span></div>
        </div>
        <div class="detail-panel">${renderDetailPanel(record, null)}</div>
      `;
      applyBadge(document.getElementById('demo-badge')!, record.status);
    }
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
  }
}

async function loadLedger(wallet: string): Promise<void> {
  const card = document.getElementById('ledger-card')!;
  const ledger = document.getElementById('ledger')!;
  try {
    const { history } = await fetchHistory(wallet);
    if (history.length === 0) {
      card.style.display = 'none';
      return;
    }
    card.style.display = 'block';
    ledger.innerHTML = `
      <table>
        <thead><tr><th>Mint</th><th>Status</th><th>Expected</th><th>Actual</th><th>Effective</th></tr></thead>
        <tbody>
          ${history
            .map(
              (row) => `
            <tr>
              <td>${row.mint.slice(0, 8)}…</td>
              <td><span class="badge ${row.status}">${statusLabel(row.status)}</span></td>
              <td>${row.expected_ratio === null ? '—' : row.expected_ratio.toFixed(4) + '%'}</td>
              <td>${row.actual_ratio.toFixed(4)}%</td>
              <td>${formatUtcDate(row.effective_timestamp)}</td>
            </tr>
          `,
            )
            .join('')}
        </tbody>
      </table>
    `;
  } catch {
    card.style.display = 'none';
  }
}

function showError(msg: string): void {
  document.getElementById('error')!.textContent = msg;
}
function clearError(): void {
  const el = document.getElementById('error');
  if (el) el.textContent = '';
}

render();
