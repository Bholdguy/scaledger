# Scaledger — DEMO

Companion to `PRD.md` Step 10. **The Step 4–5 implementation-time spike has run (see `DECISIONS.md` D9, 2026-09-14).** The real STRCx Aug 30, 2026 rebase event is confirmed `Discrepancy Flagged` (expected ratio 0.359601% vs. actual ratio 0.513716%, a gap of 0.154115 percentage points against a 0.01pp tolerance) — Branch A below is the real, shipped script. Branch B (`Verified`) has been removed per this file's own instruction, since it did not turn out to be the real outcome.

Do not edit the closing line to sound more dramatic than the real result — it doesn't need to be; the real numbers already are.

---

## Script — Steps 1–10

1. **Presenter connects a wallet holding STRCx** (or loads the seeded demo fixture via "Run Demo"). *On screen:* wallet-adapter connect flow, then the System 1 dashboard.
2. **Dashboard shows current tokenized-stock holdings** — an ordinary-looking balance list. *On screen:* ticker (STRCx), current balance, last-checked timestamp. *Narration:* "This part looks like every other tokenized-stock dashboard you'll see today. That's deliberate — it's the part that's supposed to look boring."
3. **Presenter selects the STRCx position and runs the check** (or the fixture replay plays this automatically). *On screen:* a brief loading state, then a badge appears next to the holding.
4. **Scaledger detects the real historical rebase event** — the mint's actual `UpdateMultiplierData` instruction, not a wallet balance heuristic. *On screen:* the detail panel opens, showing the transaction signature and a one-line explanation: "Detected via the mint's own multiplier-update instruction — this is what separates a real corporate action from a transfer landing in the same wallet." *Narration:* "This is the mechanism this only exists on Solana to check — Token-2022's Scaled UI Amount extension puts the rebase on the mint account itself, in the open."
5. **It fetches the real corporate-action size** for that dividend — source shown on screen, sourcing mode disclosed literally. *On screen:* the dividend amount ($0.50/share), the source (manually sourced from Strategy's press release / dividend-history record, since the xStocks API returned an authentication error within the time-box — see `DECISIONS.md` D9), and — never omitted — the `source_mode: manual` label.
6. **It computes the expected multiplier ratio and compares it to the actual on-chain multiplier ratio.** *On screen:* both ratios, side by side, with their sources and timestamps (expected 0.359601% vs. actual 0.513716%).
7. **The dashboard flags a discrepancy** — a real 0.154115 percentage-point gap, computed from real numbers, not the brief's original placeholder figures. *On screen:* red/amber "Discrepancy Flagged" badge, both numbers displayed with sources and timestamps, and the wallet's own derived token/dollar impact shown as a clearly-separated, labeled-as-derived line beneath the two source facts.
8. **Presenter clicks Export**, showing a CSV/JSON record with everything needed to independently verify the claim.
9. **Presenter shows the legal-claim tag** on the same holding, sourced from Backed Finance's factsheet.
10. **Presenter closes:**

> *"This isn't a portfolio dashboard. It's the receipt tokenized stocks don't currently give you — two independently sourced numbers, compared in the open, so you don't have to take a support reply's word for your own dividend. In this case, the two numbers don't match — and now there's a specific, exportable, sourced record of exactly how much they're off by."*

**Rehearsed answer if a judge asks "is this live or historical data?":** *"The rebase detection and the on-chain ratio are read live from Solana mainnet, right now — that part's never faked. The corporate-action reference is [sourced live from xStocks' public API / manually sourced from Strategy's own SEC filing, disclosed on screen] — we're honest about which one on every record, because pretending a manual reference is live would defeat the entire point of a verification tool."*

---

## Shared closing note

The "Run Demo" button and its on-screen label ("Demo data — frozen fixture of real STRCx history") stay visible per PRD.md Step 10 — the audience should never be uncertain about which mode is live during the presentation. If time allows, run the live path once before the judge session to confirm the fixture still matches current chain state (mainnet is append-only for past events, so this should always hold, but confirming costs one command and removes any doubt).

**Real numbers for this record** (`DECISIONS.md` D9): dividend $0.50/share (12.00% p.a., semi-monthly, period ending 2026-08-31, source: Strategy press release / stockanalysis.com dividend history — manual, xStocks API unreachable/unauthenticated), net of 30% withholding = $0.35; prior close (STRC, 2026-08-28) = $97.33 (Yahoo Finance); expected_ratio = 0.359601%; on-chain old_multiplier = 1.0753686544887686, new_multiplier = 1.0808929977256367 (Solana mainnet, mint `Xs78JED6PFZxWc2wCEPspZW9kL3Se5J7L5TChKgsidH`); actual_ratio = 0.513716%; discrepancy = 0.154115pp against a 0.01pp tolerance.
