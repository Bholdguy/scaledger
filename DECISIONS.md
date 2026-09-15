# Scaledger — DECISIONS

Every pivot from the original build brief, with full reasoning, in chronological order.

---

## D1 — Rebase detection model corrected: mint-level multiplier update, not wallet-level balance increase

**Brief assumed:** "an on-chain balance-increase transaction signed by the issuer's known rebase/mint authority... traceable to that authority's address or program instruction."

**Found:** Solana Token Extensions' Scaled UI Amount extension (`solana.com/docs/tokens/extensions/scaled-ui-amount`) implements rebasing as a mint-level `UpdateMultiplierData` instruction that changes `ScaledUiAmountConfig.multiplier` on the **mint account**. Confirmed live: STRCx's real mint (`Xs78JED6PFZxWc2wCEPspZW9kL3Se5J7L5TChKgsidH`) carries this extension with authority `S7vYFFWH6BjJyEsdrPQpqpYTqLTrPRK6KW3VwsJuRaS`. No holder's token account balance (raw amount) is ever touched by a rebase — only the mint's multiplier changes, and every holder's *displayed* balance is `raw_amount × multiplier`, recomputed on read.

**Decision:** `RebaseEvents` is keyed by mint, not wallet, with no `balance_before`/`balance_after` columns (those don't exist at the protocol level). Detection is an instruction-type + target-account filter (`UpdateMultiplierData` on the mint, signed by its authority), not a heuristic over a wallet's transaction signers. This makes the "exclude a plain transfer" invariant structurally provable rather than heuristic — a `Transfer`/`TransferChecked` instruction is a different instruction on a different account entirely.

**Why it matters:** this is a strictly better foundation than the brief's assumption, not a downgrade — it removes an entire class of false-positive risk (a large transfer being mistaken for a rebase) that a signer-based heuristic would have carried.

---

## D2 — Verification computed once per mint, never per wallet

**Original draft (first PRD pass) assumed:** each wallet's holding gets its own `expected_change`/`actual_change` comparison, implying the verification pipeline might run once per (wallet, event) pair.

**Corrected on user review:** a rebase is a mint-wide event — every holder experiences the identical multiplier change. There is exactly one Verified/Flagged/Unavailable verdict per `(rebase_event, corporate_action_reference)` pair. A specific wallet's personal token/dollar impact is derived arithmetic (`wallet's raw balance × ratio`) computed on top of the shared verdict, at display time, and is never a third independently-sourced input to the Verified/Flagged decision.

**Decision:** `VerificationRecords` has a unique constraint on `(rebase_event_id, corporate_action_reference_id)`, with no wallet column. `GET /api/verification?mint=` looks up this shared row; a separate `GET /api/holdings/:wallet/:mint/impact` computes the derived personal-impact display fields without ever writing them back into `VerificationRecords`. Tests in `TESTING.md` Section 5 explicitly assert two different wallets see the identical stored verdict.

**Why it matters:** re-running detection/fetch/compute per wallet would have been wasted RPC/API calls (rate-limit risk per `SECURITY.md`) and, worse, created a path for the same real-world event to be computed inconsistently across wallets if timing or a transient API failure differed between requests. Computing once and looking up removes that risk entirely.

---

## D3 — "Two independent facts," not "two independent numbers" that quietly implied three

**Found on user review:** the original contract language ("expected_change" vs. "actual_change," both described as coming from "independently fetched" sources) could be read as implying three independent inputs once a per-wallet balance was added to the comparison: the corporate-action size, the on-chain multiplier change, *and* the wallet's balance.

**Decision:** the contract (PRD.md Section 1) now names exactly two facts — (a) the expected multiplier ratio from the corporate-action reference, (b) the actual multiplier ratio from the mint's own multiplier change — and states explicitly that a wallet's balance is never counted as a third source. The comparison is a ratio-vs-ratio comparison at the mint level; a wallet's balance only enters the picture afterward, to translate an already-decided verdict into a personal dollar figure.

**Why it matters:** this keeps the "never assert a match from anything but two independently-sourced, stored facts" invariant true under audit — a reviewer checking `VerificationRecords` sees exactly two foreign-keyed sources feeding `status`, with nothing else in the computation.

---

## D4 — Chainlink's "xStocks Data Streams" is not a directly-queryable third-party endpoint; xStocks' own public API is the real integration point

**Brief assumed:** "Chainlink's xStocks Data Streams, unconfirmed as of this writing."

**Found:** Chainlink is confirmed as xStocks' oracle infrastructure partner (joined the xStocks Alliance, computes/validates the published multiplier), but this is not a separately documented, third-party-queryable product for external developers — generic Chainlink Data Streams docs (`docs.chain.link/data-streams`) describe an unrelated subscription-based low-latency price-feed product. The real, closest-to-confirmed accessible integration point is **xStocks' own public API** (`docs.xstocks.fi`/`api.xstocks.fi`), whose published docs describe no-auth public endpoints for asset metadata, proof of reserve, oracle/multiplier data, and corporate-action schedules. A commercial alternative, **CF Benchmarks' xStocks Corporate Actions Feed**, is confirmed real and live but requires a paid license — ruled out for a free hackathon build.

**Caveat, disclosed rather than hidden:** the xStocks API docs pages returned HTTP 403 to this research pass's automated fetch (consistent with bot-blocking, not confirmed as unreachable to a real browser/API client) — so the exact field-level schema is unconfirmed pending a Day 1 implementation spike.

**Decision:** Step 4 tries the xStocks public API first (pending the spike confirming it), with an immediate, time-boxed (2-hour) fallback to a manually-sourced, explicitly-labeled SEC filing or issuer dividend-page reference. The UI always discloses `source_mode` (`live`/`manual`) — never silently substitutes one for the other.

---

## D5 — Backed Finance factsheets are static PDFs, not an API

**Found:** confirmed real, at the pattern `documents.backed.fi/backed-assets-factsheet-<TICKER>.pdf`. STRCx's issuer is Backed Assets (JE) Limited, a Jersey SPV, issuing "tracker certificates" (debt instruments referencing the underlying stock, not direct equity/voting rights).

**Decision:** Step 7's legal-claim tag is populated by hand-transcribing the relevant line from the actual fetched PDF into a small `IssuerDisclosures` config, with the PDF linked as source — not a live API integration. Simpler and lower-risk than the brief implied.

---

## D6 — Backpack Securities mint/redeem API is stretch-only, not core-path

**Found:** confirmed real, launched Sep 13, 2026 (one day before initial PRD research). ED25519 keypair auth (`X-API-Key`/`X-Signature`/`X-Timestamp` headers), a `GET /api/v1/securities` discovery endpoint exists, but response schema for redemption terms is undocumented in any source found during research. STRCx is a Backed Finance/Kraken-distributed ticker, not confirmed as Backpack-issued.

**Decision:** Step 7's Backpack-API branch is explicitly stretch-only, attempted only if a Backpack-issued ticker is confirmed in scope and time remains after Step 9. The core path (Backed factsheet PDF) covers the demo ticker unconditionally.

---

## D7 — The brief's specific ~0.917%/~0.773% figures do not survive contact with real, current data; no discrepancy outcome is assumed ahead of the implementation-time spike

**Brief assumed:** a specific, named ~0.14 percentage-point discrepancy for STRCx, framed as the load-bearing demo case.

**Found, in three stages:**
1. Identified the likely source filing: Strategy Inc.'s **Form 8-K filed January 2, 2026** (STRC dividend rate to 11.00% p.a., $0.916666667/share for the period ending Jan 31, 2026). Applying xStocks' documented rebase formula (`net dividend after 30% US withholding ÷ prior close`, not `÷ par value`) to this filing suggested the brief's ~0.14pp "gap" might be fully explained by that formula rather than being a genuine protocol error — i.e., the real answer for *that specific event* might be `Verified`, not `Discrepancy Flagged`.
2. On continued research, found the January 2026 filing is now **stale** — STRC's dividend rate and even its payment cadence (monthly → semi-monthly, $0.50/period at 12.00% p.a.) have both changed since then, most recently effective mid-August 2026.
3. **Directly queried the live STRCx mint on Solana mainnet** (`getAccountInfo`, `Xs78JED6PFZxWc2wCEPspZW9kL3Se5J7L5TChKgsidH`): confirmed a real, currently-effective multiplier pair — `old_multiplier = 1.0753686544887686`, `new_multiplier = 1.0808929977256367`, effective `2026-08-30T23:55:00Z` (an actual multiplier increase of ≈0.5137%). This is the most recent real on-chain rebase as of planning time (today, per system context, is 2026-09-14) and supersedes the January filing as the natural demo candidate. The exact matching STRC prior-close price for this specific window could not be confirmed from available secondary sources within this research pass (two sources gave inconsistent figures) — so whether this specific event is Verified or Flagged remains genuinely open pending Step 4–5's implementation-time live spike.

**Decision:** no specific discrepancy value or outcome is pinned in `PRD.md`, `TESTING.md`, or `DEMO.md` ahead of that spike. The spike (run in code, against live RPC and the real price/dividend source — not ad hoc research) determines both which real event is canonical (defaulting to the most recent one, currently the Aug 30, 2026 event, unless a more recent one has occurred by build time) and which real status it produces. `DEMO.md` is written with both outcome branches fully scripted; whichever is real ships, and the other is deleted before presentation. This is not a downgrade of the product's premise — PRD.md Section 8 states explicitly that an honest Verified result is a complete, real proof of the verification layer, not a lesser demo than catching an error.

**Ticker choice unaffected:** STRCx remains the demo ticker. It remains the best-documented real case available (mint confirmed live on-chain, factsheet confirmed, dividend filings confirmed, and it is Solana's own Token-2022 Scaled UI Amount mechanism in active, current use) — only the assumed *outcome* of comparing it against a specific historical figure is retracted, not the choice of ticker itself.

---

## D8 — Solana RPC methods: no pivot needed

Confirmed standard and sufficient: `getTokenAccountsByOwner`, `getSignaturesForAddress`, `getTransaction`, `getAccountInfo` (for TLV extension parsing), `getTokenAccountBalance`. Pagination and rate-limit handling documented in `SECURITY.md` Section 3 rather than requiring a design change.

---

## D9 — Step 5 implementation-time spike result: real STRCx Aug 30, 2026 event is `Discrepancy Flagged`, discrepancy ≈0.154pp

**Spike performed live** (2026-09-14), against real sources, before any downstream code was written:

1. **On-chain fact (actual ratio) — read directly from the live STRCx mint** via `getAccountInfo` on `Xs78JED6PFZxWc2wCEPspZW9kL3Se5J7L5TChKgsidH`, decoding the Token-2022 TLV extension area. The `ScaledUiAmountConfig` extension (TLV type `25`, 56-byte payload: 32-byte authority + f64 `multiplier` + i64 `new_multiplier_effective_timestamp` + f64 `new_multiplier`) is currently at rest with `multiplier = 1.0808929977256367`. This is the mint's *current* multiplier — meaning the Aug 30 event's `new_multiplier` is still in effect today, confirming the candidate identified during PRD research (D7) is indeed the canonical, most-recent completed rebase as of build time. (The same read also shows a *next scheduled* update, `new_multiplier = 1.0863570205637327` effective `2026-09-15T00:30:00Z` — one day after today's spike — which is a distinct, future event and explicitly out of scope for the canonical fixture; noted here only so Step 3's detector isn't surprised by it appearing in tomorrow's chain state.)
   - `old_multiplier = 1.0753686544887686`, `new_multiplier = 1.0808929977256367` (both from D7's original on-chain read, now corroborated as still the mint's settled state).
   - `actual_ratio = new_multiplier / old_multiplier − 1 = 0.513716%` (increase).
   - **Not yet pinned in this spike:** the exact `tx_signature` of the `UpdateMultiplierData` instruction itself. The mint's recent transaction volume is extremely high (dozens of signatures per minute, almost entirely transfers/trades), so walking `getSignaturesForAddress` back ~15 days to Aug 30 within the spike's time-box was not attempted — that walk is Step 3's job proper (bounded lookback + pagination + backoff, per `SECURITY.md` Section 3), not this spike's. The spike's purpose (confirm Verified vs. Flagged using real data) does not require the signature, only the multiplier values, which are independently confirmed via the mint's own account state.
2. **Corporate-action fact (expected ratio):**
   - **xStocks API — confirmed unusable within the 2-hour time-box, exactly as D4 flagged as a risk.** `docs.xstocks.fi` returns HTTP 403 to automated fetch (consistent with D4's research-time finding). More importantly, the "no-auth public" corporate-actions endpoint itself — `api.xstocks.fi/api/v1/corporate-actions` — returned HTTP 500 with body `{"error":"Internal server error","message":"Unauthenticated"}` when queried directly. This is a stronger negative result than D4's original "unconfirmed" — it's now confirmed that this endpoint requires authentication that was not documented as needed. **Step 4 falls back to manual sourcing immediately, per PRD.md Step 4's designed fallback path** — this is the fallback working as designed, not a failure of the plan.
   - **Manual sources used instead**, both independently obtained:
     - **Dividend size:** STRC (Strategy Inc.'s Variable Rate Series A Perpetual Stretch Preferred Stock) paid a semi-monthly cash dividend of **$0.50/share**, at a **12.00% per annum** rate, for the period with ex-dividend/record date **2026-08-31** (payment 2026-09-15) — confirmed via two independent sources: (a) web search results citing Strategy's own press releases/dashboard confirming the 12.00% rate held through August 2026, and (b) `stockanalysis.com`'s STRC dividend history page, which independently lists $0.500/share for the Aug 31, 2026 ex-date. STRC's SEC 8-K filings for this window (fetched directly from `data.sec.gov`, filings dated 2026-08-03 through 2026-08-31) contain only Regulation FD bitcoin-treasury disclosures — the periodic dividend-rate reset is communicated via press release/dashboard, not a dedicated 8-K, so the press release / dividend-history-site combination is the correct manual citation, not a workaround.
     - **Prior close price:** STRC's real closing price on **2026-08-28** (the last trading day before the Aug 30 rebase's effective weekend timestamp) was **$97.33** (`$97.33000183105469`), read from Yahoo Finance's public chart API (`query1.finance.yahoo.com/v8/finance/chart/STRC`) — a real, live market-data pull, not invented.
   - `source_mode = manual` for the dividend-size reference (xStocks live path unusable); the prior-close price is sourced the same way per PRD.md Step 5's "same sourcing precedence" rule.
3. **Computation** (`net_dividend_after_30%_withholding ÷ prior_close_price`, per the documented xStocks formula):
   - `net_dividend = $0.50 × (1 − 0.30) = $0.35`
   - `expected_ratio = 0.35 / 97.33000183105469 = 0.359601%`
4. **Comparison:** `|expected_ratio − actual_ratio| = |0.359601% − 0.513716%| = 0.154115 percentage points`, which is **greater than** the `VERIFICATION_TOLERANCE_PP = 0.01` default tolerance.

**Resolved outcome: `discrepancy_flagged`.** The real, current-data result lands on the same side of the line as the brief's original assumption (Section 0 item 4 / D7 flagged this as coincidental-at-best) — but for a different, more current event (the Aug 30, 2026 rebase, not the January 2026 filing) and via the correct formula (net-of-withholding dividend ÷ prior close, not dividend ÷ par value). The ≈0.154pp gap is close to the brief's original ~0.14pp figure by coincidence of STRC's dividend rate and price both landing in a similar range — it is not the same calculation and must not be treated as validating the original number.

**Decision:** `DEMO.md` Branch A (Discrepancy Flagged) ships; Branch B (Verified) is deleted from `DEMO.md` at Step 10. `fixtures/strcx-canonical-event.json` is pinned with the exact values above. Step 3's implementation must still independently locate and record the real `tx_signature` for this event (via the bounded, paginated mint-history scan) — this spike confirms *which values* the fixture should freeze, not that Step 3's detector code can be skipped.

**Why it matters:** this is exactly the scenario PRD.md Section 8 anticipated either way — a real, honestly-computed result, not an assumed one. It happens to be the more dramatic outcome, but it was not chosen; it was measured.

---

## D10 — Step 3 scans the multiplier-update authority's signature history, not the mint's

**ARCHITECTURE.md Section 3 (and PRD.md Step 3) specified:** scan the **mint account's** transaction history via `getSignaturesForAddress(mint)`, filtering for `UpdateMultiplierData` instructions signed by the resolved authority.

**Found during Step 3 implementation (2026-09-14), contradicting that plan's practical feasibility:** Token-2022's `TransferChecked` instruction includes the mint account as a read-only reference (to verify decimals) — meaning **every ordinary trade/transfer of STRCx, not just rebase events, shows up in the mint account's own signature history.** Live sampling of `getSignaturesForAddress` on the real STRCx mint showed roughly 30–50 signatures **per minute** near build time — walking back even the 15 days needed to reach the canonical Aug 30 event would mean paginating and running `getTransaction` on several hundred thousand signatures. This is not feasible on rate-limited public RPC within any practical time budget (SECURITY.md Section 3's bounded-lookback design anticipated needing *some* limit, but not that "recent history for one popular mint" could still be this large).

**Resolution (user-confirmed):** scan `getSignaturesForAddress(authority)` — the resolved multiplier-update authority's own signature history — instead of the mint's. This changes only which side of the same on-chain relationship is paginated from; the detection semantics are unchanged and still fully structural: a result only counts if (a) the fetched transaction contains a `Token-2022` instruction whose discriminant is `UpdateMultiplierData` (outer byte `43`, sub-instruction `1`), (b) that instruction's account list includes the target mint, and (c) — automatically, since we're already enumerating this specific signer's own history — the authority is a party to the transaction. Live sampling of the authority's own signature history showed ~50 sigs/hour (≈18,000 over 15 days) — tractable in ~18 paginated `getSignaturesForAddress` calls versus a walk of the mint's history that would require well over 100 such calls plus a `getTransaction` call per signature.

**Why it matters / why this isn't cheating the invariant:** the non-negotiable is "detection is structural (instruction-type + target-account filter), never a wallet-balance heuristic" (CONTRACT.md, DECISIONS.md D1) — that property is unchanged. Nothing about *which address's history is enumerated first* weakens the structural exclusion of `Transfer`/`TransferChecked` instructions; those still fail the discriminant check regardless of which address's signature list surfaced the candidate transaction. `ARCHITECTURE.md` Section 3 step 1 is updated to reflect this as the implemented scan source.

**Follow-up finding (still 2026-09-14): even the authority-scoped scan did not complete live within this session.** After switching to the authority's history, two live attempts were made: (1) via `@solana/web3.js`'s `Connection` class, which hit a sustained wall of `429` responses on public `api.mainnet-beta.solana.com` (likely compounded by this session's own prior research traffic) and eventually crashed on a raw socket error the client's built-in retry didn't handle; (2) a hand-rolled, heavily-throttled raw-fetch scanner (1.2s between calls, pre-filtered to only fetch full transactions within ±3 days of the known Aug 30 effective timestamp) made real progress — 16 pages of `getSignaturesForAddress`, correctly reaching the target date window and correctly confirming several real `TransferChecked` instructions touching the mint are *not* misclassified — but ultimately hung on an un-timed-out `fetch` call and was stopped rather than left to hang indefinitely.

**Interim decision (2026-09-14):** the real `tx_signature` for the canonical Aug 30 event was left as an explicit placeholder in `fixtures/strcx-canonical-event.json` rather than guessed or silently defaulted, pending either a paid RPC key or another attempt at a heavily-throttled public-RPC scan.

**Resolved (2026-09-15): the real signature is now pinned and independently confirmed — no paid RPC key was needed after all.** Rather than signing up for a Helius/QuickNode account (which needs email verification/CAPTCHA no automated session can complete), the authority-scoped scan was retried against public `api.mainnet-beta.solana.com`, this time with two fixes that avoided the prior session's failure modes: (1) `disableRetryOnRateLimit` plus a custom `fetch` wrapper enforcing a hard 12s per-call timeout (yesterday's hang was an un-timed-out `fetch` call, not just rate-limiting), and (2) accepting that the scan would simply take a long time (~35 minutes, 21 pages of `getSignaturesForAddress`, one-call-at-a-time pacing) rather than trying to rush it.

**Found:** transaction `5SNeWC8YzL7rEHYKmmgYrradpYgTboBRY6WdrH4Z8xwHuK2q4zRd2AthjDtKjYc7vf7vFGxYFA3vGZ69Rg6XDjsm`, slot 442965897, block time `2026-08-30T20:06:42Z` (submitted ~3h49m before its scheduled effective timestamp — consistent with xStocks publishing a multiplier update ahead of when it takes effect).

**Confirmed as the same event, not a coincidentally-nearby one — checked two independent ways:**
1. **Our own production decoder** (`decodeUpdateMultiplierInstruction`, the exact function `RebaseDetectionService` uses) classified an instruction in this transaction as `UpdateMultiplierData` with `newMultiplier = 1.0808929977256367` and `effectiveTimestamp = 1788134100` — both an **exact match** (not epsilon-close, exact) to D9's `new_multiplier` and to `2026-08-30T23:55:00.000Z`.
2. **Solana RPC's own official `jsonParsed` instruction decoder** (a second, independent decoder we did not write) parsed the same instruction as `{"type": "updateMultiplier", "authority": "S7vYFFWH6BjJyEsdrPQpqpYTqLTrPRK6KW3VwsJuRaS", "mint": "Xs78JED6PFZxWc2wCEPspZW9kL3Se5J7L5TChKgsidH", "newMultiplier": "1.0808929977256367", "newMultiplierTimestamp": 1788134100}` — confirming program, instruction type, authority, mint, and both numeric values independently of our own code.
3. `tx.meta.err` is `null` (the transaction succeeded on-chain) and the authority account (`S7vYFFWH6BjJyEsdrPQpqpYTqLTrPRK6KW3VwsJuRaS`) is listed with `signer: true` in the transaction's own account list — confirmed as an actual signer, not merely a referenced account.

**Bonus finding, not previously known:** this same transaction batches a *second* `updateMultiplier` instruction with `newMultiplier = "1.0753686544887686"` (an exact string match to D9's `old_multiplier`) and `newMultiplierTimestamp = 1786667400` (`2026-08-14T00:30:00Z`). This appears to be the authority's update tooling re-affirming the already-active Aug 14 schedule in the same transaction as scheduling the new Aug 30 one — not a second rebase event, since its effective timestamp is in the past relative to this transaction and matches a value already accounted for as `old_multiplier`. It does not change the fixture or any pinned number; it is additional corroborating evidence, not a new fact requiring re-computation.

**Decision:** `fixtures/strcx-canonical-event.json` now has a real, on-chain, doubly-confirmed `tx_signature` — no remaining placeholder values anywhere in the canonical fixture. Step 3's Definition of Done (TASKS.md) is now fully met, not partially.
