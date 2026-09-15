# Scaledger — PRD
Stocklana Hackathon · submissions close **Fri Sep 18, 2026, 4:00pm ET**
Status: DRAFT for approval — no implementation code written yet.

---

## 0. Research findings that shape this PRD

All five dependencies named in the brief were checked against current, live documentation before any design decision below. Full citations and the reasoning behind every pivot are in `DECISIONS.md` (to follow after PRD approval); the load-bearing conclusions are summarized here because they change the brief's assumptions in material ways.

| Dependency | Status | Impact on design |
|---|---|---|
| **Solana Token Extensions — Scaled UI Amount** | Confirmed, official (`solana.com/docs/tokens/extensions/scaled-ui-amount`). xStocks confirmed to actually use this extension on Solana (`docs.xstocks.fi/developers/multipliers`). | **Corrects the brief's mental model.** A rebase is not a per-wallet balance-increase transaction. It is a mint-level `UpdateMultiplierData` instruction, signed by the mint's designated multiplier-update authority, that changes `ScaledUiAmountConfig.multiplier` in the **mint account**. Raw token amounts in every holder's token account are untouched — only the *displayed* (`uiAmount`) balance changes, computed as `raw_amount × multiplier`. This is structurally a completely different instruction, on a completely different account (the mint, not the token account), from a `Transfer`/`TransferChecked` instruction. This makes the "exclude a plain transfer" invariant in the brief easier to prove than assumed — it isn't heuristic signer-filtering, it's instruction-type + target-account filtering, which is unambiguous. |
| **Chainlink xStocks Data Streams** | **Real, but not the integration point.** Chainlink is confirmed as xStocks' oracle infrastructure partner (joined the xStocks Alliance) and computes/validates the multiplier xStocks publishes. It is *not* a separately documented, third-party-queryable Chainlink product — generic Chainlink Data Streams docs (`docs.chain.link/data-streams`) are for an unrelated low-latency price-feed product requiring a Chainlink subscription, and no public evidence of a directly callable "xStocks Data Streams" endpoint for external developers was found. | **Pivot:** the real accessible integration point is **xStocks' own public API** (`docs.xstocks.fi` / `api.xstocks.fi`), which per its published docs exposes no-auth public endpoints for asset metadata, proof of reserve, oracle/multiplier data, and corporate-action schedules. This API could not be directly fetched during this research pass (returned HTTP 403 to automated fetch, consistent with bot-blocking, not confirmed as unreachable in a browser) — so it is **unconfirmed at the field/schema level** and must be spiked on Day 1 (Step 4) before being relied on. A commercial alternative, **CF Benchmarks' xStocks Corporate Actions Feed**, is confirmed real and live but explicitly requires a paid license — ruled out for a free hackathon build. |
| **Backed Finance per-ticker factsheets** | Confirmed real and confirmed as **static PDFs**, not an API: pattern `documents.backed.fi/backed-assets-factsheet-<TICKER>.pdf`. STRCx's issuer is confirmed as Backed Assets (JE) Limited, a Jersey SPV, issuing "tracker certificates" (debt instruments referencing the underlying stock). | Step 7's factsheet tag is a **fetched static file**, parsed or hand-extracted once, not a live queryable API. This is simpler than the brief implied and lower-risk. |
| **Backpack Securities mint/redeem API** | Confirmed real, launched Sep 13, 2026 (one day before this PRD). ED25519 keypair auth (`X-API-Key` / `X-Signature` / `X-Timestamp` headers), a `GET /api/v1/securities` discovery endpoint exists. **Response schema for redemption terms is not publicly documented in any source found** — genuinely as sparse as the brief warned. | STRCx (the demo ticker) is a **Backed Finance / Kraken-distributed** ticker, not confirmed as Backpack-issued — so this integration may not even apply to the demo ticker. Combined with undocumented schema and nontrivial per-request signing infra, **Step 7's Backpack-API branch is stretch-only**, gated on a Backpack-issued ticker actually being in scope and time remaining after Step 9. |
| **Solana RPC methods** | Confirmed. `getTokenAccountsByOwner` (current holdings), `getSignaturesForAddress` + `getTransaction` (history, paginated via `before` cursor), `getAccountInfo` on the mint (to parse the Token-2022 TLV extension and read `ScaledUiAmountConfig`), `getTokenAccountBalance` (returns `uiAmount`, already multiplier-applied). | Standard, well-documented, no pivot needed. Rate limits on public RPC are real — see `SECURITY.md` for pagination/backoff handling. |
| **The specific STRC dividend filing behind the brief's ~0.917%/~0.773% figures** | Identified: Strategy Inc.'s **Form 8-K filed January 2, 2026**, declaring an STRC dividend-rate increase to **11.00% per annum** and a monthly cash dividend of **$0.916666667/share** for the period ending January 31, 2026 (record date Jan 15, 2026; paid Jan 31, 2026). This is almost certainly the source of "~0.917%" (it's 0.9167% of STRC's $100 stated value). **The ~0.14pp gap vs. the reported ~0.773% actual rebase could NOT be confirmed as a genuine on-chain discrepancy.** xStocks' documented rebase formula is `net dividend after 30% US withholding ÷ prior trading day's closing price` — not `dividend ÷ par value`. Back-of-envelope, $0.9167 × 0.70 ÷ (STRC's real prior close, plausibly ≈$83, well within its real trading range) lands close to 0.773% on its own — meaning the "gap" the brief describes may just be gross-dividend-rate vs. withholding-and-price-adjusted-rebase-rate, not a mint error. This could not be settled without live on-chain multiplier data and the real prior-close price, neither of which this research pass queried. | **Pivot:** Steps 4–5–6–10 no longer hardcode "must reproduce ~0.14%." They require a **Day 1–2 live spike** — pull the real 8-K number, the real prior close, and the real on-chain `old_multiplier`/`new_multiplier` — and whichever real, correctly-computed result comes out (Verified *or* Discrepancy Flagged) becomes the canonical demo case. STRCx remains the demo ticker (best-documented case available: mint confirmed, factsheet confirmed, dividend filing now confirmed); only the *assumed outcome* is no longer pinned ahead of real data. Full reasoning in `DECISIONS.md`. |

**Net effect on scope:** the core mechanism (Detect → Fetch → Compute → Compare → Flag) is intact and, if anything, more precisely provable than the brief assumed, because rebase detection is now an instruction-type check on the mint account rather than a heuristic over wallet transaction signers. Two real risks remain, both now explicit rather than papered over: Step 4's live-fetch source (spike-then-fallback, UI always discloses sourcing mode), and Step 5's assumed discrepancy value (spike-then-honest-result, no pinned number until real data confirms one).

---

## 1. Product contract (Step 1 deliverable, stated here so every later step can be checked against it)

**The verification decision is made once per `(mint, corporate-action event)` — never per wallet.** A rebase is a mint-wide event: every holder of that mint experiences the identical multiplier change. There is exactly one Verified/Flagged/Unavailable verdict per rebase event, computed from exactly two independently-sourced facts:

- **Fact (a) — expected multiplier ratio:** derived from a `CorporateActionReferences` row, using xStocks' own documented formula: `net_dividend_per_share (after 30% US withholding) ÷ prior trading day's closing price`. Source: SEC filing or xStocks' public API.
- **Fact (b) — actual multiplier ratio:** `new_multiplier ÷ old_multiplier` read directly from a `RebaseEvents` row — the mint's own `UpdateMultiplierData` instruction data, read via Solana RPC.

**Verified** means facts (a) and (b) both exist, are stored with source and timestamp, and their absolute difference is within a defined tolerance (default: **0.01 percentage points**, configurable, documented in code as a named constant — not a magic number).

**Discrepancy Flagged** means both facts exist and are stored, but `|expected_ratio − actual_ratio| > tolerance`.

**Reference Unavailable** (a third, explicit state — not a variant of either above) means: a `RebaseEvents` row exists (a real on-chain multiplier change was detected) but no `CorporateActionReferences` row could be fetched or sourced for it. The UI must show this state literally, never silently substitute a placeholder, and never render a green/red verdict when this state is active.

**A holder's personal token/dollar impact is a derived display number, not a third input.** Once the mint-level verdict above is decided, a specific wallet's "your balance should have changed by X, actually changed by Y" is computed by multiplying that wallet's own raw token balance (held at the event's effective time, read via a plain historical balance query — not a transaction) by the expected and actual multiplier ratios respectively. This arithmetic never feeds back into the Verified/Flagged decision; it only personalizes the display of a decision that was already made at the mint level. Two different wallets holding the same mint always see the identical status, computed once and looked up, never re-derived per wallet.

**Never:** an LLM, a UI heuristic, or a single number asserts a match or mismatch. Every badge traces to exactly two stored, independently-sourced facts a user can click to inspect — never three, and a per-wallet balance is never counted as one of them.

---

## 2. The five-stage loop (restated as the spine every step is checked against)

**Detect** rebase (mint-level multiplier change, not wallet balance heuristics) → **Fetch** real corporate-action reference (live xStocks API if the Day-1 spike confirms it; else manually sourced and labeled) → **Compute** expected change → **Compare** against actual on-chain change → **Flag** and record discrepancy (or Verified, or Reference Unavailable).

System 1 (wallet dashboard) touches none of these five stages — it is scaffolding to make System 2 demoable, and every PR/commit touching only System 1 should be viewed with suspicion against scope creep.

---

## 3. Non-negotiable invariants (carried from the brief, now sharpened by research)

1. Rebase detection filters on **`UpdateMultiplierData` instructions targeting the specific ticker's mint account**, decoded from the Token-2022 program's instruction data — never "any balance increase in the wallet." A `Transfer`/`TransferChecked` instruction is a structurally different instruction on a structurally different account (token account, not mint) and is excluded by construction, not by heuristic.
2. A discrepancy is never asserted from one number or an LLM guess. Every flag traces to two independently stored rows: a `RebaseEvents` row and a `CorporateActionReferences` row — compared at the mint level, once per event, never re-derived per wallet.
3. If the real corporate-action number can't be fetched live, the system shows **"Reference Unavailable"** or **"Manually Sourced"** explicitly — never a silent placeholder, never implied automation that isn't built. The active sourcing mode (`live` / `manual`) is a stored, displayed field on every `CorporateActionReferences` row — not a footnote.
4. The legal-claim disclosure tag is sourced from the issuer's actual factsheet PDF (Backed Finance, for xStocks tickers) or, only if in scope, live from Backpack's API — never invented or paraphrased from general knowledge.
5. The Step 10 demo is deterministic: the STRCx case reproduces the identical verdict — Verified or Discrepancy Flagged, whichever the Step 4–5 spike against real data actually establishes — every run, live or fixture. No specific outcome is assumed ahead of that spike.

---

## 4. Out of scope for the hackathon build (explicit, so nothing drifts back in)

Institutional/compliance tooling, multi-chain support, general-purpose portfolio tracking, support for tickers beyond the demo ticker (STRCx) unless Step 9's ledger view is exercised with a second fixture for depth, mobile app, notification/alerting system, any write-access to the chain (this is a read-only verification tool), user auth beyond wallet-connect.

---

## 5. Build Steps (sequential, as defined in the brief — not regrouped)

### Step 1 — Lock the product contract
**What:** Write the contract in Section 1 above into the repo as `CONTRACT.md`, and encode `Verified` / `Discrepancy Flagged` / `Reference Unavailable` as an enum (`VerificationStatus`) used everywhere downstream — API responses, DB column, UI badge — so no code path can invent a fourth state or infer status from anything other than the stored comparison.
**Why (loop stage):** Gatekeeper for Compare/Flag. Without this locked first, "Verified" risks silently meaning different things in the backend comparison logic vs. the frontend badge.
**User-visible outcome:** None yet — this is the contract the rest of the product is built against.
**Backend changes:** `VerificationStatus` enum (`verified | discrepancy_flagged | reference_unavailable`) in the shared types module; a pure function `computeStatus(expected, actual, tolerance): VerificationStatus` that is the *only* place status is derived, unit-tested in isolation.
**Frontend changes:** None yet.
**Data/API/UI changes:** None yet — no external source touched.
**Testing:** Unit tests for `computeStatus`: exact match → verified; small delta under tolerance → verified; delta over tolerance → discrepancy_flagged; `expected = null` → reference_unavailable regardless of `actual`. Table-driven, at least 6 cases.
**Definition of Done:** `computeStatus` exists, is unit-tested with the 6+ cases above passing, and `CONTRACT.md` is committed with no ambiguity about what triggers each of the three states.

---

### Step 2 — Wallet-connect reference dashboard (System 1)
**What:** A page where a user connects a Solana wallet (Phantom/Solflare via wallet-adapter) and sees their current tokenized-stock balances, filtered to a known allowlist of xStocks/Backed mints (starting with the STRCx mint address, confirmed from Backed's public asset registry / xStocks API asset list).
**Why (loop stage):** Not itself a loop stage — this is the reference workload the brief explicitly says must not become the product. It exists only to give Steps 3–9 a real holder context to attach to.
**User-visible outcome:** User can connect a wallet and see their tokenized-stock holdings and current balances — the "ordinary brokerage app" baseline.
**Backend changes:** `GET /api/holdings?wallet=<address>` — calls Solana RPC `getTokenAccountsByOwner` filtered to Token-2022 program ID, cross-references returned mints against the allowlist table, returns ticker + current `uiAmount` per holding. Persists/upserts into `Wallets` and `Holdings`.
**Frontend changes:** Wallet-adapter connect button; holdings list component (ticker, balance, last-checked timestamp). No verification UI yet.
**Data/API/UI changes:** Touches **Solana RPC** only (`getTokenAccountsByOwner`, `getTokenAccountBalance`). Populates `Wallets`, `Holdings` tables.
**Testing:** Integration test against a real devnet or a real mainnet wallet known to hold STRCx (or a fixture wallet), asserting the returned holdings list contains the expected ticker and a balance matching what a manual `getTokenAccountBalance` call returns.
**Definition of Done:** Connecting a real wallet holding STRCx renders its correct current balance on screen, sourced from a live RPC call (not a hardcoded value).

---

### Step 3 — Rebase event detection
**What:** Identify the STRCx mint's multiplier-update authority address (read from the mint's `ScaledUiAmountConfig` extension via `getAccountInfo` + TLV parsing), then scan **that authority's own** transaction history (`getSignaturesForAddress` on the authority, paginated via `before` cursor, then `getTransaction` per signature) for `UpdateMultiplierData` instructions targeting this mint. Per DECISIONS.md D10 (found during implementation): scanning the mint's own signature history is infeasible in practice, because Token-2022's `TransferChecked` instruction references the mint account for every ordinary trade, so the mint's history is dominated by trading volume, not rebase events. Scanning the authority's history instead is a data-access optimization, not a detection-semantics change — a match still requires the decoded instruction to be `UpdateMultiplierData` and its accounts to include this mint. No wallet is involved either way. Each match yields `old_multiplier`, `new_multiplier`, the tx signature, and the effective timestamp.
**Why (loop stage):** This *is* the **Detect** stage — the mechanism the entire product depends on.
**User-visible outcome:** Nothing new on screen yet (this is backend), but the system now has a provably-real, provably-excluding-transfers list of rebase events for STRCx to build on — shared across every wallet that holds the mint, computed once.
**Backend changes:** `RebaseDetectionService`: (a) `resolveMultiplierAuthority(mint)` — parses Token-2022 mint extension TLV; (b) `findMultiplierUpdates(mint, authority)` — walks the **authority's** tx history via `getSignaturesForAddress`/`getTransaction` (DECISIONS.md D10), decodes Token-2022 program instructions, filters to `UpdateMultiplierData` instructions whose accounts include this mint, extracts `old_multiplier`/`new_multiplier`/effective timestamp. Writes one `RebaseEvents` row per detected event — keyed by mint, never by wallet.
**Frontend changes:** None yet.
**Data/API/UI changes:** Touches **Solana RPC** exclusively (`getAccountInfo`, `getSignaturesForAddress`, `getTransaction`). Populates `RebaseEvents`.
**Testing (canonical fixture — STRCx):** Two assertions against real historical mainnet data: (1) a known historical STRCx `UpdateMultiplierData` transaction on the mint is correctly identified as a `RebaseEvents` row with the correct `old_multiplier`/`new_multiplier`; (2) a plain SPL `Transfer`/`TransferChecked` transaction anywhere in the mint's or a holder's history is **not** picked up — asserted by running detection over a transaction set that includes both and checking the transfer's signature never appears in the resulting `RebaseEvents` rows. This exclusion is structural (wrong instruction type, wrong target account), not heuristic, so the test is really confirming the decoder, not getting lucky.
**Definition of Done:** Running `RebaseDetectionService` against the real STRCx mint returns the known historical rebase event with correct `old_multiplier`/`new_multiplier`, and a known transfer transaction in the same range is verifiably excluded — both checked by an automated test, not manual inspection.

---

### Step 4 — Real corporate-action reference fetch
**What:** For the ticker and rebase date identified in Step 3, fetch the real dividend size. Primary path (pending the Day-1 spike, see Section 0): xStocks' public API corporate-actions/multiplier endpoint. Fallback path, used immediately if the spike fails or the endpoint is undocumented/unreachable within a fixed time-box (2 hours): a documented public reference for STRC's actual dividend (Strategy Inc.'s SEC 8-K filing or `strategy.com/strc/dividends`), entered as a `CorporateActionReferences` row explicitly labeled `source_mode = manual`.
**Why (loop stage):** This is the **Fetch** stage — the second, independent number the whole comparison depends on.
**User-visible outcome:** Still backend-only, but the number that will anchor the "Verified"/"Flagged" badge now exists and is stored with a labeled source.
**Backend changes:** `CorporateActionReferenceService.fetch(ticker, date)` — tries the live xStocks endpoint first if the Day-1 spike marked it usable; on failure/absence, reads from a small, explicitly-labeled manual reference table/config checked into the repo (ticker, date, dividend amount, source URL, `source_mode: 'manual'`). Every returned reference carries `source_mode` (`live` | `manual`) and `source_url`.
**Frontend changes:** None yet.
**Data/API/UI changes:** Touches **xStocks public API** (if the spike confirms it) or a **documented manual reference** (SEC filing / issuer dividend page) otherwise. Populates `CorporateActionReferences`.
**Testing:** For the STRCx case, assert the fetched/sourced reference matches the real, citable dividend value for the canonical on-chain event identified in Section 0 (candidate: the STRCx multiplier update effective Aug 30, 2026 — reconfirmed at implementation time per DECISIONS.md D7, since STRC's rate and cadence have changed more than once since the brief was drafted) and that `source_mode` and `source_url` are both non-null and correct.
**Definition of Done:** A `CorporateActionReferences` row exists for the STRCx demo date with a real, citable number and an explicit, correct `source_mode` — verified live if the spike succeeded, verified manual with a working source URL if it didn't.

---

### Step 5 — Expected-change calculation and comparison
**What:** Compute the **expected multiplier ratio** from the Step 4 reference using xStocks' own documented rebasing formula (`net dividend after 30% US withholding ÷ prior trading day's closing price`), then diff it against the Step 3 **actual multiplier ratio** (`new_multiplier ÷ old_multiplier`). This comparison happens entirely at the mint level — no wallet or balance is involved yet.
**Why (loop stage):** This is the **Compute** and **Compare** stages — where the two independent facts actually meet.
**User-visible outcome:** Still backend-only, but the verdict (Verified / Discrepancy Flagged / Reference Unavailable) for this mint event is now decided and stored, once.
**Backend changes:** `computeExpectedRatio(reference, priorClosePrice)` implementing the documented formula exactly; `computeActualRatio(rebaseEvent)` = `new_multiplier / old_multiplier`; both feed `computeStatus` from Step 1. Writes one `VerificationRecords` row per `(rebase_event_id, corporate_action_reference_id)` pair — not per wallet.
**Frontend changes:** None yet.
**Data/API/UI changes:** No new external source — pure computation over Steps 3+4's stored data, plus the real prior-day closing price for STRC (needed for the formula; sourced the same way as Step 4 — live xStocks/market-data reference if available, else a documented public price source, labeled). Writes to `VerificationRecords` (not yet displayed).
**Testing — real-data spike required (see Section 0, item 4):** The brief's assumed ~0.14 percentage-point gap could not be confirmed as a genuine on-chain discrepancy during PRD research — it may instead be fully explained by the withholding-tax/price-ratio formula, in which case the real answer is `Verified`, not `Discrepancy Flagged`. Before this step is implemented against pinned values, run the real pipeline once against the canonical on-chain event identified in Section 0 (candidate: the STRCx multiplier update effective Aug 30, 2026 — reconfirmed at implementation time per DECISIONS.md D7, since the January 2026 filing this section originally referenced has since been superseded twice), the real STRC prior closing price, and the real on-chain `old_multiplier`/`new_multiplier` for STRCx's corresponding rebase. Whichever real, correctly-computed status results — Verified or Discrepancy Flagged — becomes the pinned expected value for the regression test and for Step 10's fixture. The test asserts exact, pinned values once they're known; it must never be left as an approximate "roughly matches" check, and it must never assume the discrepancy outcome ahead of the spike.
**Definition of Done:** Running the pipeline against real STRCx data produces a `VerificationRecords` row whose `status` and stored expected/actual ratios reproduce real, citable numbers confirmed by the spike above — checked by an automated test with pinned expected values, not eyeballed, and not assumed.

---

### Step 6 — Discrepancy flag and math display
**What:** Surface Step 5's mint-level result in the UI: a badge (`Verified` / `Discrepancy Flagged` / `Reference Unavailable`) next to the holding on the System 1 dashboard, with a click-through panel showing both source facts, their timestamps, their `source_mode`/`source_url`, and — as a clearly-labeled *derived* line, not a third source — this specific wallet's personal token/dollar impact (`this wallet's raw balance at event time × expected ratio` vs. `× actual ratio`).
**Why (loop stage):** This is where **Flag** becomes visible — the first point in the whole build where a user actually sees the product's core value.
**User-visible outcome:** User sees a badge on their STRCx holding and can click it to see exactly why — the two source facts, sourced and timestamped, side by side, plus what that meant for their own balance.
**Backend changes:** `GET /api/verification?mint=` returns the single shared `VerificationRecords` row for that mint's latest event (computed once in Step 5, looked up — never re-run per request) joined with its `RebaseEvents` and `CorporateActionReferences` rows. A separate, thin `GET /api/holdings/:wallet/:mint/impact` computes the wallet-specific derived display numbers on top of that shared verdict.
**Frontend changes:** Badge component on the holdings list (color-coded per `VerificationStatus`, with a distinct neutral color for `reference_unavailable` — never green or red); an expandable detail panel showing the two source facts plus the wallet's derived personal impact, visually distinguished from the two source facts so a user never mistakes the derived number for a third independent source.
**Data/API/UI changes:** No new external source — renders Steps 3–5's stored data plus one historical-balance RPC read for the derived personal-impact line. UI must literally render `source_mode` (e.g., "Sourced live from xStocks API" vs. "Manually sourced from SEC 8-K filing") — never omit it.
**Testing:** Component/UI test asserting the STRCx case renders the correct status (whichever Step 5's real-data spike established) with the two source facts and the derived personal-impact line visible on click; a synthetic "matches exactly" fixture renders `Verified`; a synthetic "no reference" fixture renders the neutral `Reference Unavailable` state; and a test asserting two different wallet addresses querying the same mint's verdict get the identical `status` from the same stored `VerificationRecords` row (proving it wasn't re-derived per wallet).
**Definition of Done:** Loading the STRCx holding in the running app shows the correct badge, and clicking it displays the real source facts plus this wallet's derived impact with correct sources — observable in the browser, not just in a test runner.

---

### Step 7 — Legal-claim disclosure tag
**What:** A one-line tag per holding describing its actual legal structure, sourced from Backed Finance's published factsheet PDF for xStocks tickers (`documents.backed.fi/backed-assets-factsheet-<TICKER>.pdf`, fetched and the relevant line extracted/hand-transcribed with the PDF linked as source). The Backpack live-API variant is **stretch-only**, attempted only if time remains after Step 9 and only if a Backpack-issued ticker is confirmed in scope.
**Why (loop stage):** Adjacent to the loop (a disclosure, not a detect/fetch/compute/compare/flag step) but required by the brief as a trust signal alongside the verification badge — it must never be invented.
**User-visible outcome:** User sees, next to the badge, a factual one-liner (e.g., "Tracker certificate issued by Backed Assets (JE) Limited — no voting rights") with a link to the source PDF.
**Backend changes:** A small `IssuerDisclosures` config/table (ticker → tag text → source PDF URL), populated by hand from the actual fetched factsheet PDF for STRCx — not paraphrased from general knowledge of tokenized stocks. `GET /api/holdings` response includes this tag.
**Frontend changes:** Small disclosure line under each holding's badge, source PDF linked.
**Data/API/UI changes:** Touches **Backed Finance's published factsheet PDF** (static file fetch, done once, transcribed accurately). Backpack API integration (stretch) would touch `GET /api/v1/securities`.
**Testing:** Assert the STRCx disclosure tag's text is a faithful transcription of a specific line in the actual fetched factsheet PDF (manual verification step recorded in the test/comment, since PDF text isn't practical to assert programmatically at this scope) and that the source link resolves to the real PDF.
**Definition of Done:** The STRCx holding shows an accurate, sourced legal-claim tag linking to the real Backed Finance factsheet PDF.

---

### Step 8 — Exportable record
**What:** A button that exports the full `VerificationRecords` row (both numbers, both sources, both timestamps, status, tolerance used) as CSV and JSON.
**Why (loop stage):** Downstream of **Flag** — this is what makes the flag actionable for a holder's own tax/records use, per the brief's business thesis.
**User-visible outcome:** User can download a file containing everything needed to independently verify the claim, without needing to trust Scaledger's UI rendering.
**Backend changes:** `GET /api/verification/:id/export?format=csv|json` — serializes the full joined record (no summarization/rounding beyond what's already stored).
**Frontend changes:** Export button in the detail panel from Step 6.
**Data/API/UI changes:** No new external source — pure serialization of already-stored data.
**Testing:** Export the STRCx record and assert the CSV/JSON contains the exact expected/actual numbers, both source URLs, both timestamps, and the status — parseable and complete, checked by re-parsing the exported file in the test.
**Definition of Done:** Clicking Export on the STRCx holding downloads a file that, opened independently, contains every number and source needed to redo the comparison by hand.

---

### Step 9 — Running ledger view
**What:** A history table of every `VerificationRecords` event relevant to the connected wallet's holdings, across sessions — joined from the shared, mint-level `VerificationRecords` rows against whichever mints this wallet has ever held.
**Why (loop stage):** Extends **Flag**/record persistence across time — turns one checked event into an accumulating verified history, per the brief's Experience C.
**User-visible outcome:** User sees a table of past checks (ticker, date, status, expected/actual ratios, their personal derived impact) instead of only the single most recent one.
**Backend changes:** `GET /api/verification/history?wallet=` joins the wallet's `Holdings` mints against all `VerificationRecords` rows for those mints, ordered by date — it does **not** re-run detection/fetch/compute per wallet; it looks up already-computed, shared mint-level verdicts.
**Frontend changes:** A ledger/history table component below the holdings list.
**Data/API/UI changes:** No new external source — reads persisted `VerificationRecords` across runs. Requires the DB to actually persist across the demo session (not in-memory-only), since this is the first step that depends on data surviving between page loads.
**Testing:** Run the STRCx check twice in one session (or once, reload, then view history) and assert the ledger shows one persisted row that survives a page reload — proves persistence, not just in-memory state. Also assert that a second, distinct wallet holding the same STRCx mint sees the identical `VerificationRecords` row in its own ledger, rather than a duplicate freshly-computed one.
**Definition of Done:** Reloading the dashboard after running a check still shows that check in the ledger table, and a second wallet holding the same mint sees the same stored verdict without re-computation.

---

### Step 10 — Deterministic demo path
**What:** A "Run Demo" button that loads a faithful fixture of the real STRCx mint/rebase/reference data (captured once from the real Steps 3–5 pipeline output, using whichever real status — Verified or Discrepancy Flagged — the Step 5 spike established, and frozen as a fixture) and walks Detect → Fetch → Compute → Compare → Flag on command, independent of live RPC/API availability on stage.
**Why (loop stage):** Insurance across the whole loop — guarantees the demo doesn't depend on live RPC latency, xStocks API uptime, or finding a fresh event live on stage.
**User-visible outcome:** Presenter clicks one button and the full flow (Steps 2 through 6) plays out identically every time, ending in the same real, verified result.
**Backend changes:** A `demo` mode flag that swaps live RPC/API calls for the frozen fixture data at each of the five stages, using the *same* code paths (`RebaseDetectionService`, `CorporateActionReferenceService`, `computeExpectedRatio`/`computeActualRatio`, `computeStatus`) as the live path — the fixture substitutes only the data source, never the logic, so the demo is proof of the real pipeline, not a scripted mockup.
**Frontend changes:** "Run Demo" button; a clear on-screen label ("Demo data — frozen fixture of real STRCx history") so the deterministic path is never confused with a live claim, per the honesty invariant.
**Data/API/UI changes:** No new external source — replays previously captured real data through the real logic.
**Testing:** Run "Run Demo" three times in a row and assert byte-identical output (same ratios, same status) every time.
**Definition of Done:** Clicking "Run Demo" three times in a row produces the identical result every time — whatever that real, spike-confirmed result is — and the screen clearly discloses that fixture data is in use. **Note:** if the Step 5 spike shows STRCx's real canonical event (candidate: the Aug 30, 2026 multiplier update, per DECISIONS.md D7) is actually Verified (no genuine discrepancy), the demo script and presenter narrative in `DEMO.md` must be built around an honest "Verified" walkthrough rather than forcing a discrepancy narrative that isn't real — see `DECISIONS.md` for the resolved outcome once the spike runs.

---

## 6. Data model (revised from the brief to match mint-level protocol reality — see corrections above)

- `Wallets(address, connected_at)`
- `Holdings(wallet, mint, ticker, balance, last_checked)` — per-wallet, unchanged from the brief; this is System 1's table.
- `RebaseEvents(id, mint, tx_signature, old_multiplier, new_multiplier, effective_timestamp)` — **keyed by mint only, no wallet column.** `tx_signature` is the `UpdateMultiplierData` transaction on the mint account. There is no per-wallet balance_before/balance_after at the protocol level, because `UpdateMultiplierData` doesn't touch any token account — only the mint's `ScaledUiAmountConfig`.
- `CorporateActionReferences(id, ticker, action_type, size, prior_close_price, source, source_mode, source_url, effective_date)` — `source_mode ∈ {live, manual}` added per the honesty invariant (Section 3, item 3). `prior_close_price` added — required by xStocks' documented rebase formula and previously missing from the brief's table. `source_url` added to match Step 4's own requirement that every reference carry a resolvable source link, not just a source label.
- `VerificationRecords(id, rebase_event_id, corporate_action_reference_id, expected_ratio, actual_ratio, discrepancy, status, tolerance_used)` — **one row per `(rebase_event_id, corporate_action_reference_id)` pair, never per wallet.** `expected_ratio`/`actual_ratio` replace the brief's `expected_change`/`actual_change`, since the comparison is a multiplier ratio at the mint level, not a wallet balance delta. `tolerance_used` added so a later change to the tolerance constant never silently reinterprets historical records. A wallet's personal token/dollar impact is **not stored here** — it's computed on demand (Step 6) by multiplying the wallet's own historical raw balance by `expected_ratio`/`actual_ratio`, and is never persisted as if it were a third independent fact.

## 7. Core metrics (unchanged from brief)
1. Time from rebase detection to verification result shown
2. % of checked rebases with a real, sourced reference vs. reference-unavailable
3. Discrepancy magnitude distribution
4. Export-to-verification ratio
5. Coverage — distinct tickers verifiable against a real reference source

## 8. Judging-criteria audit (Stocklana: real user/problem, working end-to-end demo, reason it belongs on Solana, execution quality)

- **Real user/problem:** a holder needing a defensible, independently-checkable number for a real STRC dividend rebase is a real, citable scenario — preserved through the research pass. The *specific* ~0.14pp gap named in the brief is not yet confirmed as a genuine protocol discrepancy (Section 0, item 4) — this is disclosed rather than asserted, and the product's value holds either way: an honest "Verified" result is still a real, working demonstration of independent verification, not a lesser outcome.
- **Working end-to-end demo:** Step 10 guarantees this independent of live-API risk, and now also independent of which real verdict the data produces.
- **Reason it belongs on Solana:** strengthened, not weakened, by research — the entire detection mechanism now rests on a Solana-specific primitive (Token-2022's `ScaledUiAmountConfig`/`UpdateMultiplierData`) that has no equivalent to audit this way on a brokerage statement.
- **Execution quality:** the contract in Section 1 (mint-level verdict, wallet-level display, never conflated), the real-data-spike-then-pin regression test in Step 5, and the fixture-replay-through-real-logic design in Step 10 are the concrete evidence of correctness a judge can be shown, not asserted.
- **No drift check:** every step above names its loop stage explicitly; Step 2 (System 1) and Step 7 (disclosure tag) are the only two steps that don't touch Detect/Fetch/Compute/Compare/Flag directly, and both are labeled as such rather than silently folded into the core loop.
