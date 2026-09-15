# Scaledger — TESTING

Companion to `PRD.md`. Describes how the real STRCx case anchors Steps 3–6, how a false-positive rebase detection is proven impossible (not just untested), and how Step 10's deterministic replay is validated.

---

## 1. The canonical fixture: STRCx, mint `Xs78JED6PFZxWc2wCEPspZW9kL3Se5J7L5TChKgsidH`

**Confirmed live during planning** (see `DECISIONS.md` for full detail): this mint is a real Token-2022 mint with a `scaledUiAmountConfig` extension, multiplier-update authority `S7vYFFWH6BjJyEsdrPQpqpYTqLTrPRK6KW3VwsJuRaS`, and a real, currently-effective multiplier pair (`old_multiplier = 1.0753686544887686`, `new_multiplier = 1.0808929977256367`, effective `2026-08-30T23:55:00Z`). This is the most recent real rebase as of planning time and is the default candidate for the canonical fixture — Step 4's implementation-time spike confirms the exact matching dividend record and prior-close price and may instead select a more recent event if one has occurred by build time. Whichever event is selected, it is pinned by writing its `tx_signature` into the fixture — never re-selected implicitly by "most recent" at test-run time, which would make the fixture non-deterministic.

**Do not hardcode the brief's original ~0.917%/~0.773% figures as expected test values.** PRD.md Section 0 and Step 5 explicitly retract that assumption — those numbers belong to a January 2026 filing that has since been superseded twice (STRC's rate and payment cadence both changed since then). The pinned expected/actual values in every test below are whatever the real implementation-time spike produces for the actual selected event, recorded once and then treated as a regression baseline.

---

## 2. Step 3 (Detect) — the false-positive exclusion test

This is the most important test in the suite, because it's the one that proves the product's core claim: a plain transfer cannot be mistaken for a rebase.

**Setup:** pull two real signature sets from the live mint via `getSignaturesForAddress`:
- Set A: the signature of a confirmed `UpdateMultiplierData` instruction (the Aug 30, 2026 event, or whichever the implementation-time spike confirms).
- Set B: the signature of any `Transfer`/`TransferChecked` instruction touching a STRCx token account (a real trade or send — found by scanning a holder's or a DEX pool's transaction history for the mint).

**Assertion 1 (inclusion):** `RebaseDetectionService.findMultiplierUpdates(mint, authority)` run against a transaction set containing Set A returns exactly one `RebaseEvents`-shaped result with `tx_signature` matching Set A, and `old_multiplier`/`new_multiplier` matching the values read directly from `getAccountInfo`.

**Assertion 2 (exclusion, the load-bearing one):** the same service run against a transaction set containing Set B returns **zero** results referencing Set B's signature. This is asserted two ways, not one:
- (a) Behaviorally: `findMultiplierUpdates` output never contains Set B's signature.
- (b) Structurally: a unit test on the instruction decoder itself asserts that a decoded `Transfer`/`TransferChecked` instruction is never classified as `UpdateMultiplierData` regardless of signer — proving the exclusion is a property of the decoder (different instruction discriminant entirely), not an accident of which authority happened to sign the fixture transaction. This is what PRD.md Step 3 means by "structural, not heuristic" — the test has to check the mechanism, not just the outcome on one example.

**Why both:** a behavioral-only test could pass by coincidence (e.g., if the transfer just happened to not match some unrelated filter). The structural test closes that gap by asserting the decoder's classification logic directly against both instruction types side by side.

---

## 3. Step 4 (Fetch) — sourcing-mode correctness

**Live-path test (gated on the Day-1 spike confirming the xStocks API is usable):** `CorporateActionReferenceService.fetch('STRCx', date)` against the live endpoint returns a reference whose `size` matches the value independently confirmed via the SEC 8-K/issuer dividend page for the same date, and `source_mode = 'live'`.

**Manual-fallback test (always run, regardless of live-path availability):** with the live source forced to fail (mocked failure, not a real network flake — this test must be deterministic), `fetch` returns the manual reference row with `source_mode = 'manual'` and a `source_url` that resolves (a smoke-tested HTTP HEAD against the SEC/issuer URL, run separately from the main suite since it depends on an external site staying up — a failure here is a documentation-freshness alert, not a build-blocking test failure).

**Never-both test:** assert `source_mode` is never null and never a third value — the enum is `'live' | 'manual'`, checked with a type-level test plus a runtime assertion in `computeStatus`'s caller.

---

## 4. Step 5 (Compute/Compare) — the pinned regression test

Once the implementation-time spike (Section 1 above) determines the real event, its inputs and output are frozen as exact values in a single test fixture file (`fixtures/strcx-canonical-event.json`): `old_multiplier`, `new_multiplier`, `dividend_size`, `prior_close_price`, `source_mode`, and the resulting `expected_ratio`, `actual_ratio`, `discrepancy`, `status`. The regression test loads this fixture, runs it through `computeExpectedRatio` → `computeActualRatio` → `computeStatus`, and asserts byte-for-byte match against the frozen `status` and both ratios (within floating-point epsilon, not "roughly matches"). This test is the one PRD.md Step 5 calls "load-bearing" — if it starts failing after a refactor, the refactor changed real verification math, not a coincidental detail.

**Both-outcome unit coverage, independent of which one is real:** `computeStatus` itself (from Step 1's `CONTRACT.md`/enum) is tested with synthetic inputs covering all three states regardless of which one STRCx's real event lands on — this is already specified in PRD.md Step 1 and is not repeated here, but is called out because it's what makes the pinned STRCx regression test safe to have only one real outcome: the enum's other branches are still fully covered by synthetic cases.

---

## 5. Step 6 — per-mint, not per-wallet, verified by test

**Setup:** two distinct wallet addresses (can be synthetic addresses for this test — they don't need to actually hold the token, only to be passed as the `wallet` query parameter), both querying `GET /api/verification?mint=<STRCx_mint>`.

**Assertion:** both responses return the identical `VerificationRecords.id`, identical `status`, identical `expected_ratio`/`actual_ratio` — and a call-count assertion on the mocked `RebaseDetectionService`/`CorporateActionReferenceService` confirms neither was invoked a second time for the second wallet's request. This is the direct test of the correction logged in `DECISIONS.md`: the verdict is computed once and looked up, not re-derived per wallet.

**Derived-field isolation test:** `GET /api/holdings/:wallet/:mint/impact` for the two different wallets (with different balances) returns different `personal_expected_change`/`personal_actual_change` values (proving the arithmetic is genuinely per-wallet) while both still reference the same underlying `VerificationRecords.id` and `status` (proving the derived numbers never leak back into or alter the shared verdict).

---

## 6. Step 10 — deterministic replay validation

**Repeat-run test:** invoke the demo-mode pipeline three times in a single test run. Assert the three resulting `VerificationRecords` objects (not yet written to the real DB in test mode — compared in memory or against a scratch DB) are field-for-field identical: same `expected_ratio`, `actual_ratio`, `status`, `discrepancy`. Any difference is a bug in fixture determinism (e.g., an uncontrolled timestamp or random ID leaking into a compared field) and fails the build.

**Same-code-path test:** assert that `demo` mode and `live` mode both call through the identical `computeExpectedRatio`/`computeActualRatio`/`computeStatus` functions — enforced structurally by only ever injecting a different `DataSource` implementation (`SolanaRpcSource` vs. `FixtureSource`, per `ARCHITECTURE.md` Section 6), never a parallel demo-specific compute function. A test that mocks `DataSource` and swaps implementations mid-suite, then asserts identical downstream compute-function invocations, is suffient to catch any future PR that accidentally special-cases demo mode's math.

---

## 7. What is explicitly not tested (and why that's fine for this scope)

- Load/concurrency testing — single-demo-ticker hackathon build, not a production service (PRD.md Section 4).
- Wallet-adapter signing flows — Scaledger never requests a signature (`SECURITY.md` Section 2), so there's no signing path to test.
- Full historical backfill correctness across STRCx's entire lifetime — the lookback window (`SECURITY.md` Section 3) is a deliberate scope boundary; only the canonical event and its immediate neighbors need coverage.
