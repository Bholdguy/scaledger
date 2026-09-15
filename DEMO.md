# Scaledger — DEMO

Companion to `PRD.md` Step 10. **The Step 4–5 implementation-time spike has run (see `DECISIONS.md` D9, 2026-09-14).** The real STRCx Aug 30, 2026 rebase event is confirmed `Discrepancy Flagged` (expected ratio 0.359601% vs. actual ratio 0.513716%, a gap of 0.154115 percentage points against a 0.01pp tolerance) — Branch A below is the real, shipped script. Branch B (`Verified`) has been removed per this file's own instruction, since it did not turn out to be the real outcome.

Do not edit the closing line to sound more dramatic than the real result — it doesn't need to be; the real numbers already are.

---

## Script — Steps 1–10

1. **Presenter pastes a wallet address holding STRCx** (or clicks "Connect Phantom"; the seeded demo fixture also plays via "Run Demo" without needing a wallet at all). *On screen:* the input/connect row, then the System 1 dashboard.
2. **Dashboard shows current tokenized-stock holdings** — an ordinary-looking balance list, including the issuer disclosure line under the ticker. *On screen:* ticker (STRCx), current balance, last-checked timestamp, and the Backed Finance legal-claim tag with its source link. *Narration:* "This part looks like every other tokenized-stock dashboard you'll see today. That's deliberate — it's the part that's supposed to look boring."
3. **Presenter clicks "Run Demo"** (or "Run Live Check" for the real-time path). *On screen:* a brief "Demo data — frozen fixture of real STRCx history" banner, then a badge appears next to the STRCx holding.
4. **Scaledger detects the real historical rebase event** — the mint's actual `UpdateMultiplierData` instruction, not a wallet balance heuristic. *Narration:* "This is a mechanism that only exists on Solana to check — Token-2022's Scaled UI Amount extension puts the rebase on the mint account itself, in the open, which is why we can point at one instruction and say 'this is the rebase' instead of guessing from a balance change." *(The instruction's real transaction signature is not shown inline on the badge/detail panel today — it's in the exported CSV/JSON record, which is where a holder would actually want it for their own records. If a judge asks to see it live, open the export.)*
5. **It fetches the real corporate-action size** for that dividend. *(The raw dividend amount and `source_mode` label are not rendered inline in the current build either — only the two computed ratios are. The full sourcing detail — $0.50/share, manually sourced from Strategy's dividend-history record since the xStocks API returned an authentication error within the time-box, see `DECISIONS.md` D9 — is in the exported record.)* *Narration, said plainly rather than implied by the screen:* "The dividend size behind this number was manually sourced — the xStocks API we hoped to use returned an auth error, so we're using Strategy's own public dividend record instead, and that's disclosed in the exported file."
6. **It computes the expected multiplier ratio and compares it to the actual on-chain multiplier ratio.** *On screen:* both ratios, side by side (expected 0.359601% vs. actual 0.513716%), plus the discrepancy and tolerance.
7. **The dashboard flags a discrepancy** — a real 0.154115 percentage-point gap, computed from real numbers, not the brief's original placeholder figures. *On screen:* red "Discrepancy Flagged" badge, both ratios and the discrepancy displayed, and the wallet's own derived token/dollar impact shown as a clearly-separated, labeled-as-derived line beneath the two source facts.
8. **Presenter clicks Export (CSV or JSON)** — this is where the transaction signature, the dividend amount, the prior close price, and the `source_mode`/`source_url` all actually appear together, everything needed to independently verify the claim by hand.
9. **Presenter points back at the legal-claim tag** already visible under the holding (shown in step 2), sourced from Backed Finance's factsheet.
10. **Presenter closes:**

> *"This isn't a portfolio dashboard. It's the receipt tokenized stocks don't currently give you — two independently sourced numbers, compared in the open, so you don't have to take a support reply's word for your own dividend. In this case, the two numbers don't match — and now there's a specific, exportable, sourced record of exactly how much they're off by."*

**Rehearsed answer if a judge asks "is this live or historical data?":** *"The rebase detection and the on-chain ratio are read live from Solana mainnet, right now — that part's never faked. The corporate-action reference is manually sourced from Strategy's own dividend-history record, not xStocks' API — its auth-gated endpoint didn't work within our time-box, and that's disclosed in the exported record rather than pretended away. Pretending a manual reference is live would defeat the entire point of a verification tool."*

**If a judge asks "why isn't the source shown right there on the badge?":** *"Fair catch — today the inline panel shows the two computed ratios, and the full sourcing detail (the signature, the dividend figure, the source label) is one click away in the export. That's a real gap versus our own spec, which we're not going to paper over — it's on the list, not hidden."*

---

## Shared closing note

The "Run Demo" button and its on-screen label ("Demo data — frozen fixture of real STRCx history") stay visible per PRD.md Step 10 — the audience should never be uncertain about which mode is live during the presentation. If time allows, run the live path once before the judge session to confirm the fixture still matches current chain state (mainnet is append-only for past events, so this should always hold, but confirming costs one command and removes any doubt).

**Real numbers for this record** (`DECISIONS.md` D9): dividend $0.50/share (12.00% p.a., semi-monthly, period ending 2026-08-31, source: Strategy press release / stockanalysis.com dividend history — manual, xStocks API unreachable/unauthenticated), net of 30% withholding = $0.35; prior close (STRC, 2026-08-28) = $97.33 (Yahoo Finance); expected_ratio = 0.359601%; on-chain old_multiplier = 1.0753686544887686, new_multiplier = 1.0808929977256367 (Solana mainnet, mint `Xs78JED6PFZxWc2wCEPspZW9kL3Se5J7L5TChKgsidH`); actual_ratio = 0.513716%; discrepancy = 0.154115pp against a 0.01pp tolerance.
