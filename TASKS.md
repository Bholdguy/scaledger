# Scaledger — Task Checklist

Ordered exactly by PRD.md's 10 build steps. Each item is a single checkable action with its Definition of Done attached, copied verbatim from PRD.md so this file never drifts from the source of record.

---

## Step 1 — Lock the product contract
- [x] Write `CONTRACT.md` from PRD.md Section 1 (mint-level verdict; two independent facts — expected ratio, actual ratio; per-wallet impact as derived arithmetic only; three-state `VerificationStatus` enum).
- [x] Implement `VerificationStatus` enum (`verified | discrepancy_flagged | reference_unavailable`) in the shared types module (`src/shared/types.ts`).
- [x] Implement `computeStatus(expected, actual, tolerance): VerificationStatus` as the sole place status is derived.
- [x] Write 6+ table-driven unit tests per TESTING.md/PRD.md Step 1 (exact match, under-tolerance, over-tolerance, null-expected) — 9 cases written, `tests/computeStatus.test.ts`, all passing (`npx vitest run`).
- **DoD:** ✅ MET — `computeStatus` exists, is unit-tested with 9 passing cases (exceeds the 6+ requirement), and `CONTRACT.md` is committed with no ambiguity about what triggers each of the three states.

## Step 2 — Wallet-connect reference dashboard (System 1)
- [x] Integrate wallet connect flow — Phantom's injected provider (`window.solana.connect()`) directly rather than the full `@solana/wallet-adapter-react` stack, since the only thing this product needs from wallet-adapter is a public key and no signing is ever requested (SECURITY.md Section 2) — a deliberate hackathon-speed simplification, not a scope cut; a pasted-address input is also supported so the flow works without Phantom installed. `src/client/main.ts`.
- [x] Build the mint allowlist table, seeded with `DEMO_TICKER_MINT` (STRCx) — `src/shared/allowlist.ts`.
- [x] Implement `GET /api/holdings?wallet=` — `getParsedTokenAccountsByOwner` filtered to Token-2022 + allowlist, upserts `Wallets`/`Holdings` (`src/server/holdingsService.ts`, `src/server/app.ts`).
- [x] Build the holdings list UI component (ticker, balance, last-checked, issuer disclosure) — `src/client/main.ts` + `style.css`.
- [x] Integration test against a real fixture wallet holding STRCx (`tests/holdingsService.integration.test.ts`) — passes against live mainnet, balance cross-checked via a second, independent RPC call.
- **DoD:** ✅ MET — verified in a real headless-Chromium browser (Playwright), not just curl: loading wallet `41Mjig92SfveWPKkqis78hF3a75cpe96n1uuVuMAdkJF` renders its real STRCx balance (39,285.153204) on screen, sourced live, with zero console errors.

## Step 3 — Rebase event detection
- [x] Implement `resolveMultiplierAuthority(mint)` — via `@solana/spl-token`'s `unpackMint`/`getScaledUiAmountConfig` (Token-2022 TLV parsing), confirmed live against the real STRCx mint (authority `S7vYFFWH6BjJyEsdrPQpqpYTqLTrPRK6KW3VwsJuRaS`, matching DECISIONS.md D1 exactly). `src/server/rebaseDetectionService.ts`.
- [x] Implement `findMultiplierUpdates(mint, authority)` — paginated `getSignaturesForAddress`/`getTransaction` walk + `UpdateMultiplierData` instruction decode, **scanning the authority's history, not the mint's** (DECISIONS.md D10 — the mint's own history is dominated by ordinary trading volume via `TransferChecked`, infeasible to walk on public RPC). `sequenceOldMultipliers` chains raw updates into complete `RebaseEvent`s with `old_multiplier` filled in.
- [x] Wire writes to `RebaseEvents` (mint-keyed, unique on `tx_signature`) — `recordRebaseEvent`.
- [x] **Inclusion test against the real STRCx mint — resolved 2026-09-15 (DECISIONS.md D10).** A throttled, hang-safe authority-history scan (public RPC, no paid key needed — `disableRetryOnRateLimit` + a hard 12s per-call timeout fixed the prior session's hang) located `tx_signature = 5SNeWC8YzL7rEHYKmmgYrradpYgTboBRY6WdrH4Z8xwHuK2q4zRd2AthjDtKjYc7vf7vFGxYFA3vGZ69Rg6XDjsm` (slot 442965897, block time 2026-08-30T20:06:42Z). Confirmed as the same event two independent ways: our own decoder AND Solana RPC's own `jsonParsed` decoder both report `newMultiplier`/timestamp values that exactly match D9's pinned `new_multiplier` and effective timestamp; `tx.meta.err` is null and the authority is a confirmed signer. `fixtures/strcx-canonical-event.json` now has this real signature — no placeholder remains. `tests/rebaseInclusion.real.test.ts` freezes the real captured values as a regression fixture (2 tests).
- [x] Structural exclusion test (decoder never classifies `Transfer`/`TransferChecked` as `UpdateMultiplierData`, checked against real Token-2022 instruction encodings via `@solana/spl-token`'s own encoders — not hand-rolled bytes) — `tests/decodeUpdateMultiplierInstruction.test.ts`, 6 tests passing, per TESTING.md Section 2.
- **DoD:** ✅ **FULLY MET.** Running the detector against the real STRCx mint/authority returns the known historical rebase event with correct `old_multiplier`/`new_multiplier`, now with a real, doubly-confirmed `tx_signature` — and the structural exclusion of `Transfer`/`TransferChecked` is automated and passing. Both checked by automated tests, not manual inspection.

## Step 4 — Real corporate-action reference fetch
- [x] **Spike (done during the Step 5 spike, see DECISIONS.md D9):** live fetch against `api.xstocks.fi/api/v1/corporate-actions` returned `{"error":"Internal server error","message":"Unauthenticated"}` — confirmed unusable, well within the 2-hour time-box.
- [x] Implement `CorporateActionReferenceService.fetch(ticker, date)` (`fetchCorporateActionReference`) with live-then-manual-fallback logic, `source_mode`/`source_url` always populated. `src/server/corporateActionReferenceService.ts`.
- [x] Populated the manual reference fallback table with the real, citable dividend figure ($0.50/share, 12.00% p.a. semi-monthly, period ending 2026-08-31 — Strategy press release / stockanalysis.com dividend history) for the actual selected event.
- [ ] Write the live-path test (gated on spike success) — **not written**, since the spike confirmed the live path is currently unusable (would need to mock a hypothetical working response, which the spike deliberately avoided asserting since the real schema was never confirmed). The always-run manual-fallback path is exercised indirectly by `tests/verificationPipeline.demo.test.ts` and `tests/pinnedCanonicalEvent.test.ts`, but no dedicated unit test isolates `fetchCorporateActionReference` itself yet.
- **DoD:** ✅ MET for the manual path (the one actually in use) — a `CorporateActionReferences`-shaped reference with real, citable numbers, `source_mode: 'manual'`, and a working `source_url` is produced and recorded end-to-end (proven by the demo pipeline tests). The live path exists in code but is unexercised since xStocks' API isn't usable.

## Step 5 — Expected-change calculation and comparison
- [x] **Resolve the canonical demo event:** confirmed via live RPC (`getAccountInfo`, 2026-09-14) — the mint's `ScaledUiAmountConfig` extension currently holds `multiplier=1.0808929977256367`, confirming the Aug 30, 2026 event (`old_multiplier=1.0753686544887686` → `new_multiplier=1.0808929977256367`, effective `2026-08-30T23:55:00Z`) is still the mint's settled state and the correct canonical event as of build time.
- [x] Pulled the real matching dividend record ($0.50/share, 12.00% p.a. semi-monthly, period ending 2026-08-31 — manual sources, xStocks API returned an auth error) and real prior-close price ($97.33, STRC close 2026-08-28, Yahoo Finance) for that exact event window.
- [x] Implement `computeExpectedRatio(reference)` and `computeActualRatio(rebaseEvent)` per the documented xStocks formula — `src/shared/ratios.ts`, both pure functions, unit-tested via the pinned regression test.
- [x] Ran the calculation once against the real, resolved event; result: `expected_ratio=0.359601%`, `actual_ratio=0.513716%`, `discrepancy=0.154115pp`, `status=discrepancy_flagged`. Pinned in `DECISIONS.md` D9 and in `fixtures/strcx-canonical-event.json`.
- [x] Logged the resolved outcome (`Discrepancy Flagged`) in `DECISIONS.md` D9, with exact numbers and sources.
- [x] Wrote the pinned regression test against the frozen fixture — `tests/pinnedCanonicalEvent.test.ts`, 4 tests passing, exact-value (`toBeCloseTo` epsilon 1e-10) assertions, not approximate.
- [x] **Closed 2026-09-15 (see D10):** the real `tx_signature` is now pinned and doubly-confirmed. `fixtures/strcx-canonical-event.json` and every downstream record (`computeAndRecordVerification`/`runVerificationPipeline`) now reference a fully real, fully-cited on-chain transaction — no remaining placeholder anywhere in the canonical fixture.
- **DoD:** ✅ **FULLY MET** — real, citable numbers throughout, including the `tx_signature`, pinned and automated.

## Step 6 — Discrepancy flag and math display
- [x] Implement `GET /api/verification?mint=` (shared per-mint lookup, no re-computation) — `src/server/app.ts`.
- [x] Implement `GET /api/holdings/:wallet/:mint/impact` (derived personal-impact arithmetic, `derived: true` flagged).
- [x] Build the badge component (color per `VerificationStatus`, neutral color for `reference_unavailable`) — `.badge.verified/.discrepancy_flagged/.reference_unavailable` in `style.css`.
- [x] Build the expandable detail panel (two source facts + derived personal-impact line, visually distinguished via a dashed divider and "(derived — not an independent source)" label) — `renderDetailPanel` in `main.ts`.
- [x] Synthetic fixture coverage for all three `VerificationStatus` outcomes at the service level — `tests/verificationService.test.ts` (4 tests: verified, discrepancy_flagged, reference_unavailable, shared-lookup). The real STRCx case is covered separately by the pinned regression test and the demo pipeline test.
- [x] Two-wallets-same-verdict test (TESTING.md Section 5) — `tests/verificationPipeline.demo.test.ts` (proven structurally: `VerificationRecords` has no wallet column at all, so there is only one row to find regardless of which wallet asks).
- **DoD:** ✅ MET — verified in a real browser (Playwright, screenshot taken): loading the STRCx holding for a real wallet shows the "Discrepancy Flagged" badge; clicking it reveals both source facts (expected 0.359601%, actual 0.513716%), the discrepancy, the derived personal-impact line clearly separated from the two source facts, and working Export buttons. Zero console errors.

## Step 7 — Legal-claim disclosure tag
- [x] Fetch the real STRCx factsheet PDF from `documents.backed.fi` — fetched live (2 pages, "Data as of September 14, 2026"), read in full before transcribing.
- [x] Hand-transcribe the relevant legal-structure line into `IssuerDisclosures` config, with the PDF URL as source — `src/server/issuerDisclosureService.ts`, transcribed verbatim from the factsheet's "Product Details"/"Underlying Information" tables (Issuer: Backed Assets (JE) Limited; Underlying: Strategy Variable Rate Perpetual Stretch Prf Shs Series A).
- [x] Add the disclosure field to `GET /api/holdings` response and render it under the badge — visible in the browser screenshot, with a working link to the real PDF.
- [ ] Backpack stretch branch — not attempted (correctly out of scope per DECISIONS.md D6; STRCx is Backed-issued, not Backpack-issued).
- **DoD:** ✅ MET — verified in the browser: the STRCx holding shows "Tracker of Strategy Inc.'s Variable Rate Perpetual Stretch Preferred Stock (STRC, Series A) — issued by Backed Assets (JE) Limited, a Jersey SPV, not direct equity in Strategy Inc." with a working link to the real factsheet PDF.

## Step 8 — Exportable record
- [x] Implement `GET /api/verification/:id/export?format=csv|json` — full joined record serialization (`RebaseEvents` + `CorporateActionReferences` + `VerificationRecords`, LEFT JOIN so `reference_unavailable` records still export) — `src/server/app.ts`.
- [x] Add the Export button to the Step 6 detail panel — `main.ts`, links to both formats.
- [x] Export-then-reparse completeness test — `tests/api.export.test.ts`, 2 tests: re-parses both CSV and JSON and asserts every number/source/timestamp/status is present and correct, plus a 404-on-unknown-id case.
- **DoD:** ✅ MET — verified via automated test (re-parsing the exported file, not eyeballing) and manually via curl: both formats contain the exact expected/actual ratios, both source URLs, the tx signature, both timestamps, and the status.

## Step 9 — Running ledger view
- [x] Implement `GET /api/verification/history?wallet=` — join `Holdings` mints to `VerificationRecords`, no re-computation — `src/server/app.ts`.
- [x] Build the ledger/history table UI component — `main.ts`, visible in the browser screenshot below the detail panel.
- [x] Confirm the DB persists across process restarts (not in-memory-only) — **verified for real**, not just asserted: killed the running server process entirely, restarted it fresh, and `GET /api/verification/history` still returned the same record with the same `id`.
- [x] Reload-persistence test (browser-level, via Playwright: full page reload + re-query still shows 1 ledger row) and the shared-verdict test (`tests/verificationPipeline.demo.test.ts`).
- **DoD:** ✅ MET — confirmed both at the browser level (page reload) and the process level (full server restart), the stronger of the two checks the DoD asks for.

## Step 10 — Deterministic demo path
- [x] Implement the `DataSource` interface (`SolanaRpcSource`, `FixtureSource`) per ARCHITECTURE.md Section 6 — `src/server/dataSource.ts`.
- [x] Capture the real Step 3–5 pipeline output for the canonical event as a frozen fixture — `fixtures/strcx-canonical-event.json` (tx_signature placeholder pending D10 follow-up; every other field real).
- [x] Build the "Run Demo" button and on-screen fixture-mode disclosure label — verified in the browser screenshot ("Demo data — frozen fixture of real STRCx history...").
- [x] Three-repeat-run byte-identical-output test — `tests/verificationPipeline.demo.test.ts`.
- [x] Same-code-path structural test — enforced architecturally (`runVerificationPipeline` takes a `DataSource` and calls the identical `computeAndRecordVerification`/`computeExpectedRatio`/`computeActualRatio`/`computeStatus` regardless of which `DataSource` is injected; `SolanaRpcSource` and `FixtureSource` are the only two implementations, in `dataSource.ts`) and demonstrated by the demo pipeline test using the exact same `runVerificationPipeline` function the live `/api/verification/run` route calls.
- [x] **Finalized `DEMO.md`:** Branch B (Verified) deleted; Branch A (Discrepancy Flagged) is the single real script, with exact numbers filled in.
- **DoD:** ✅ MET — clicking "Run Demo" reproduces the identical, real, spike-confirmed `discrepancy_flagged` result every time (proven by the 3x-repeat test), and the on-screen banner discloses fixture-mode clearly.

---

## Pre-submission checklist (not a build step — a final gate)
- [x] Re-ran the cross-document terminology check during the 2026-09-15 pre-submission pass — DEMO.md's script was rewritten to match what's actually on screen (see below); no other drift found between CONTRACT.md/ARCHITECTURE.md/the codebase's actual field names and enum values.
- [x] Confirmed `.env.example` has no real secrets (verified again 2026-09-15) — all values are either public defaults or blank.
- [x] Confirmed `.env` and `data/` are gitignored and were never committed (verified via `git ls-files` after `git init`, both on initial commit and the pre-submission pass).
- [x] Confirmed the deployed build's `APP_MODE=live` and the on-screen label agree: the demo banner is driven by an explicit `mode=demo` param from the "Run Demo" click, not by the global `APP_MODE` env var, so a `live`-mode deployment still discloses fixture mode correctly whenever fixture data is actually shown.
- [x] Live deployment stood up (Railway, `https://scaledger-production.up.railway.app`) and the full Branch A demo flow re-run against it from a fresh, logged-out browser context — identical result to local (~9.4s mechanical run), export links resolve on the live domain.
- [x] Dev-artifact sweep (2026-09-15): no `console.log`/debug output in client code; no TODO/FIXME/lorem-ipsum anywhere in `src/`; no internal file paths leak into API responses (500s return a generic `"internal error"`, never a stack trace); `.env` confirmed not tracked.
- [x] **Found and fixed during the sweep:** the ledger's "Effective" date used `toLocaleDateString()` with no timezone pin, so the Aug 30 23:55 UTC event rendered as "8/31/2026" in this environment's local timezone — inconsistent with DEMO.md's fixed "Aug 30, 2026" framing and would vary by judge's timezone. Fixed to format in UTC explicitly. Also fixed the ledger badge showing the raw `discrepancy_flagged` enum instead of the friendly "Discrepancy Flagged" label used everywhere else.
- [x] **Closed 2026-09-16:** the gap flagged in the 2026-09-15 pass (detail panel showing only the two ratios, not the tx signature/dividend/`source_mode`) is fixed. `getVerificationForMint` now joins `RebaseEvents`/`CorporateActionReferences` and the API/UI render both facts' full provenance inline: Fact (a) shows "Manually sourced — dividend $0.50/share, prior close $97.33" + source link; Fact (b) shows the real tx signature (linked to Solana Explorer) + effective date. `reference_unavailable` records correctly show nothing fabricated on the reference side (unit-tested). 3 new tests added (2 service-level, 1 full-HTTP-stack against the real fixture) — 35/35 passing. Re-verified end-to-end afterward: full Branch A flow re-run locally (dev mode and the built single-service production mode) and against the redeployed live URL from a fresh browser context — identical real result each time, zero regressions, dev-artifact sweep repeated (clean).
- [x] GitHub repo created and pushed: https://github.com/Bholdguy/scaledger — includes a README a judge can read in under 30 seconds (product, the real discrepancy, how to run it, live link).
- [x] Submission requirement re-verified directly from the hackathon page (`hackathons.solana.com/hackathons/stocklana`): at least one link (GitHub, live demo, or video) — both GitHub and live demo links are ready; deadline confirmed Fri Sep 18, 4:00pm ET. **Still needed from the user:** actually filling out the platform's submission form and inviting teammates if any — that's a step on the Solana hackathon platform itself, outside what this session can do.
- [x] Time-check: this pass completed 2026-09-15, three days ahead of the Fri Sep 18 4:00pm ET deadline.
