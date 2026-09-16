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
    <header class="topbar">
      <a class="wordmark" href="/"><span class="mark">S</span>Scaledger<span class="dot">.</span></a>
      <nav class="topbar-links">
        <a href="/">Landing</a>
        <a href="https://github.com/Bholdguy/scaledger" target="_blank" rel="noopener">Source</a>
      </nav>
    </header>

    <div class="page">
      <div class="page-head">
        <p class="eyebrow">Scaledger · Verification Dashboard</p>
        <h1>Check a rebase. Get the receipt.</h1>
        <p class="page-subtitle">Independent, on-chain verification for tokenized-stock rebases — not another balance dashboard.</p>
      </div>

      <div class="control-bar">
        <div class="control-group">
          <span class="control-label">Wallet</span>
          <input id="wallet-input" placeholder="Paste a Solana wallet address (or connect Phantom)" value="${currentWallet ?? ''}" />
          <button id="load-btn">Load Holdings</button>
          <button id="connect-btn" class="secondary">Connect Phantom</button>
        </div>
        <div class="control-group">
          <span class="control-label">Verification</span>
          <button id="check-btn" class="secondary">Run Live Check</button>
          <button id="demo-btn" class="secondary">Run Demo</button>
        </div>
      </div>

      <div id="demo-banner"></div>
      <div id="error"></div>

      <div id="holdings" style="display:none"></div>
      <div id="ledger-card" style="display:none">
        <p class="section-label">Verification History</p>
        <div class="ledger-section">
          <div id="ledger"></div>
        </div>
      </div>
    </div>
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
  banner.innerHTML = '<div class="banner demo">Running a live check against Solana mainnet — this scans real transaction history and can be slow or rate-limited on public RPC (see DECISIONS.md D10).</div>';
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
  holdingsEl.innerHTML = '<p class="section-label">Holdings</p><div class="empty-state">Loading holdings from live Solana RPC…</div>';
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
    holdingsEl.innerHTML = '<p class="section-label">Holdings</p><div class="empty-state">No allowlisted tokenized-stock holdings found for this wallet.</div>';
    return;
  }
  holdingsEl.innerHTML = `
    <p class="section-label">Holdings</p>
    <div class="holdings-list">
      ${holdings
        .map(
          (h, i) => `
        <div class="holding-card">
          <div class="holding-top">
            <div>
              <div class="ticker">${h.ticker}</div>
              <div class="balance"><span class="mono">${h.balance.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span> · last checked ${new Date(h.lastChecked).toLocaleTimeString()}</div>
            </div>
            <span class="status-badge reference_unavailable" id="badge-${i}" data-mint="${h.mint}" data-wallet="${wallet}"><span class="dot"></span>Check status</span>
          </div>
          ${h.disclosure ? `<div class="disclosure">${h.disclosure.tagText} <a href="${h.disclosure.sourceUrl}" target="_blank" rel="noopener">source</a></div>` : ''}
          <div id="panel-${i}" class="detail-panel" style="display:none"></div>
        </div>
      `,
        )
        .join('')}
    </div>
  `;

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
    applyBadge(badge, 'reference_unavailable', 'Not yet checked');
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

function truncateSignature(sig: string): string {
  return sig.length > 16 ? `${sig.slice(0, 8)}…${sig.slice(-8)}` : sig;
}

/** Escapes text inserted into innerHTML — source/sourceUrl ultimately come from a
 * corporate-action reference row, not user input, but never trust rendered strings by
 * default when building HTML via template literals. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function applyBadge(badge: HTMLElement, status: string, labelOverride?: string): void {
  badge.innerHTML = `<span class="dot"></span>${escapeHtml(labelOverride ?? statusLabel(status))}`;
  badge.className = `status-badge ${status}`;
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

const SOURCE_MODE_LABELS: Record<string, string> = {
  live: 'Sourced live',
  manual: 'Manually sourced',
};

function renderDetailPanel(record: VerificationRecord, impact: ImpactResponse | null): string {
  const expected =
    record.expectedRatio === null
      ? '<span class="muted">unavailable</span>'
      : `${record.expectedRatio.toFixed(6)}%`;
  const actual = `${record.actualRatio.toFixed(6)}%`;

  // Fact (a)'s provenance: the corporate-action reference. Null fields mean
  // reference_unavailable — never fabricated, per CONTRACT.md.
  const referenceProvenance =
    record.sourceMode === null
      ? '<span class="muted">Reference Unavailable — no corporate-action record could be sourced for this event.</span>'
      : `<span class="source-mode">${escapeHtml(SOURCE_MODE_LABELS[record.sourceMode] ?? record.sourceMode)}</span>` +
        (record.dividendSize !== null
          ? ` dividend $${record.dividendSize.toFixed(2)}/share, prior close $${record.priorClosePrice?.toFixed(2) ?? '—'}`
          : '') +
        (record.sourceUrl
          ? ` <a href="${escapeHtml(record.sourceUrl)}" target="_blank" rel="noopener">source</a>`
          : '');

  // Fact (b)'s provenance: the on-chain instruction itself.
  const explorerUrl = `https://explorer.solana.com/tx/${encodeURIComponent(record.txSignature)}`;
  const eventProvenance = `<a href="${escapeHtml(explorerUrl)}" target="_blank" rel="noopener">${truncateSignature(record.txSignature)}</a> (effective ${formatUtcDate(record.effectiveTimestamp)})`;

  let html = `
    <div class="fact-grid">
      <div class="fact">
        <div class="fact-label">Fact (a) — expected multiplier ratio</div>
        <div class="fact-value">${expected}</div>
        <div class="fact-provenance">${referenceProvenance}</div>
      </div>
      <div class="fact">
        <div class="fact-label">Fact (b) — actual on-chain multiplier ratio</div>
        <div class="fact-value">${actual}</div>
        <div class="fact-provenance">${eventProvenance}</div>
      </div>
    </div>
    <div class="discrepancy-row">
      <div>
        <div class="fact-label">Discrepancy</div>
        <div class="fact-value">${record.discrepancy === null ? '—' : record.discrepancy.toFixed(6) + 'pp'}</div>
      </div>
      <span class="tolerance">tolerance ${record.toleranceUsed}pp</span>
    </div>
  `;

  if (impact) {
    const expectedChange =
      impact.personalExpectedChange === null ? '—' : impact.personalExpectedChange.toFixed(6);
    html += `
      <div class="derived-line">
        <div class="fact-label">Your balance's derived impact</div>
        <div class="fact-value mono">expected +${expectedChange} · actual +${impact.personalActualChange.toFixed(6)} (balance ${impact.balance.toLocaleString()})</div>
      </div>
    `;
  }

  html += `
    <div class="panel-actions">
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
  banner.innerHTML = '<div class="banner demo">Running demo — frozen fixture of real STRCx history…</div>';
  try {
    await runVerification(STRCX_MINT, 'demo');
    banner.innerHTML =
      '<div class="banner demo">Demo data — frozen fixture of real STRCx history (Aug 30, 2026 rebase). Not a live claim.</div>';
    if (wallet) {
      await loadWallet(wallet);
    } else {
      const record = await fetchVerification(STRCX_MINT);
      const holdingsEl = document.getElementById('holdings')!;
      holdingsEl.style.display = 'block';
      holdingsEl.innerHTML = `
        <p class="section-label">Holdings</p>
        <div class="holdings-list">
          <div class="holding-card">
            <div class="holding-top">
              <div><div class="ticker">STRCx</div><div class="balance">Demo mode — no wallet loaded</div></div>
              <span class="status-badge" id="demo-badge"></span>
            </div>
            <div class="detail-panel" style="display:block">${renderDetailPanel(record, null)}</div>
          </div>
        </div>
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
      <div class="timeline">
        ${history
          .map(
            (row) => `
          <div class="timeline-entry">
            <div class="timeline-node"><span class="dot ${row.status}"></span></div>
            <div class="timeline-body">
              <div class="timeline-head">
                <div class="timeline-title">
                  <span class="timeline-ticker">${row.mint.slice(0, 8)}…</span>
                  <span class="status-badge ${row.status}"><span class="dot"></span>${statusLabel(row.status)}</span>
                </div>
                <span class="timeline-date">${formatUtcDate(row.effective_timestamp)}</span>
              </div>
              <div class="timeline-stats">
                <div class="timeline-stat">
                  <span class="label">Expected</span>
                  <span class="value">${row.expected_ratio === null ? '—' : row.expected_ratio.toFixed(4) + '%'}</span>
                </div>
                <div class="timeline-stat">
                  <span class="label">Actual</span>
                  <span class="value">${row.actual_ratio.toFixed(4)}%</span>
                </div>
              </div>
            </div>
          </div>
        `,
          )
          .join('')}
      </div>
    `;
  } catch {
    card.style.display = 'none';
  }
}

function showError(msg: string): void {
  document.getElementById('error')!.innerHTML = `<div class="banner error">${escapeHtml(msg)}</div>`;
}
function clearError(): void {
  const el = document.getElementById('error');
  if (el) el.innerHTML = '';
}

render();
