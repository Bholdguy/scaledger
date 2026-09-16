# Scaledger

**An independent verification layer for tokenized-stock rebases on Solana — the receipt that tokenized stocks don't currently give you.**

## The real result

Scaledger checked STRCx (Backed Finance's tokenized version of Strategy Inc.'s STRC preferred stock) against its **Aug 30, 2026 rebase** — a real, on-chain Token-2022 `UpdateMultiplierData` instruction ([tx `5SNeWC8Yz...Rg6XDjsm`](https://explorer.solana.com/tx/5SNeWC8YzL7rEHYKmmgYrradpYgTboBRY6WdrH4Z8xwHuK2q4zRd2AthjDtKjYc7vf7vFGxYFA3vGZ69Rg6XDjsm)) — against the real dividend that rebase is supposed to represent.

The two numbers don't match:

| | Value | Source |
|---|---|---|
| **Expected multiplier ratio** | 0.359601% | STRC's real $0.50/share dividend (12% p.a., semi-monthly), net of 30% US withholding, ÷ the real $97.33 prior close |
| **Actual on-chain multiplier ratio** | 0.513716% | Read directly from the mint's own multiplier change on Solana mainnet |
| **Discrepancy** | **0.154115 percentage points** | Against a 0.01pp tolerance — flagged |

That gap is real, sourced, and independently reproducible — not an assumption baked into a demo. Full derivation and every source in [`DECISIONS.md`](./DECISIONS.md) (D9, D10).

## What this actually is

Tokenized stocks on Solana use Token-2022's [Scaled UI Amount extension](https://solana.com/docs/tokens/extensions/scaled-ui-amount) to implement dividend rebases: the issuer periodically updates a **mint-level multiplier**, and every holder's displayed balance is `raw_amount × multiplier`. Today, nobody outside the issuer can tell whether that multiplier update actually matches the dividend it's supposed to represent — you just see your balance change and trust it.

Scaledger is a **Detect → Fetch → Compute → Compare → Flag** pipeline that:

1. **Detects** the real `UpdateMultiplierData` instruction on the mint (never a wallet-balance heuristic — a plain transfer is structurally a different instruction on a different account and can't be confused for a rebase).
2. **Fetches** the real corporate-action reference (dividend size, prior close price) — live from xStocks' API when available, honestly labeled `manual` when it isn't (it currently isn't — see below).
3. **Computes** the expected multiplier ratio from that reference, using xStocks' own documented formula.
4. **Compares** it against the actual on-chain multiplier ratio.
5. **Flags** a verdict — `Verified`, `Discrepancy Flagged`, or `Reference Unavailable` — computed **once per mint-level event**, never per wallet, and never from a single number or a guess.

Every verdict traces to exactly two independently-sourced, stored facts a user can export and check by hand.

## What's real vs. what's disclosed as a gap

This build is honest about its own limits rather than papering over them:

- **The xStocks corporate-action API doesn't actually work** — its "public" endpoint returns an authentication error despite being documented as no-auth. The fallback (Strategy's own published dividend record) is used instead, and every record's `source_mode` (`live`/`manual`) is stored and rendered inline — never silently substituted.
- The badge's detail panel shows both source facts' full provenance inline: Fact (a) shows the `source_mode` label, the dividend size, the prior close, and a link to the source; Fact (b) shows the real on-chain transaction signature linked to Solana Explorer. Nothing is fabricated when a reference is unavailable — those fields are simply absent, never a placeholder.
- Everything — the mint-level detection mechanism, the real dividend/price data, the on-chain multiplier read, the math, the persistence, the demo replay, and the inline source disclosure — is real and automated-test-covered (35 tests, see `tests/`).

Full build log and every pivot from the original plan: [`DECISIONS.md`](./DECISIONS.md).

## Running it

```bash
npm install
cp .env.example .env          # defaults work as-is (public Solana RPC, no keys required)
npm run dev:server            # API on :8787
npx vite                      # frontend on :5173 (proxies /api to :8787)
```

Open `http://localhost:5173`. Click **Run Demo** to replay the real, frozen STRCx result above without touching live RPC, or paste a wallet address (e.g. `41Mjig92SfveWPKkqis78hF3a75cpe96n1uuVuMAdkJF`, a real STRCx holder) and click **Run Live Check** to run the pipeline against Solana mainnet directly.

```bash
npm test          # 32 tests: unit, structural-decoder, and live-mainnet integration
npm run build      # builds the frontend into dist/
npm start          # single-service production mode — API + built frontend on one port
```

## Architecture

- `src/shared/` — the product contract: `VerificationStatus` enum, `computeStatus`, the ratio math. See [`CONTRACT.md`](./CONTRACT.md).
- `src/server/rebaseDetectionService.ts` — the mint-level detector (Step 3).
- `src/server/corporateActionReferenceService.ts` — live-then-manual dividend/price sourcing (Step 4).
- `src/server/verificationService.ts` / `verificationPipeline.ts` — the once-per-mint compute/compare/record pipeline (Steps 5–6).
- `src/server/dataSource.ts` — `SolanaRpcSource` (live) and `FixtureSource` (demo) behind one interface; the demo replay runs the exact same compute code as the live path.
- `src/client/` — the wallet dashboard + verification badge/detail panel + ledger.
- `fixtures/strcx-canonical-event.json` — the frozen, fully-real, fully-cited STRCx event the demo replays.

Full spec: [`PRD.md`](./PRD.md), [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`SECURITY.md`](./SECURITY.md), [`TESTING.md`](./TESTING.md). Build progress against every step's Definition of Done: [`TASKS.md`](./TASKS.md).

## Open-source components used

`@solana/web3.js` and `@solana/spl-token` (Solana Foundation, Apache-2.0) for all on-chain reads and Token-2022 instruction decoding; `express` for the API; `vite` for the frontend build; `vitest` + `supertest` + `playwright` for testing. Full list in [`package.json`](./package.json). No forked or vendored code — everything here beyond those libraries is original to this build.

## Live demo

**https://scaledger-production.up.railway.app/app** — the functional dashboard directly. Click "Run Demo" to replay the real STRCx result without touching live RPC, or paste a wallet address and click "Run Live Check" for the live path.

## Why Solana

The entire detection mechanism rests on a Solana-specific primitive — Token-2022's `ScaledUiAmountConfig`/`UpdateMultiplierData` — that has no equivalent to audit this way on a traditional brokerage statement. A rebase here is a discrete, signed, on-chain instruction, not an opaque balance update; that's what makes independent verification possible at all.
