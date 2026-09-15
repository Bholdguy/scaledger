# Scaledger — CONTRACT

This is the product contract (PRD.md Section 1), locked as Step 1's deliverable so every
later step can be checked against it without ambiguity. `VerificationStatus` (defined in
`src/shared/types.ts`) is the *only* representation of a rebase's verification result —
API responses, the DB column, and the UI badge all read this same enum. No code path may
invent a fourth state or infer status from anything other than `computeStatus`'s output.

## The verification decision is made once per `(mint, corporate-action event)` — never per wallet

A rebase is a mint-wide event: every holder of that mint experiences the identical
multiplier change. There is exactly one Verified/Flagged/Unavailable verdict per rebase
event, computed from exactly **two independently-sourced facts** — never three, and never
a single number or an LLM's guess:

- **Fact (a) — expected multiplier ratio:** derived from a `CorporateActionReferences` row,
  using xStocks' documented formula: `net_dividend_per_share (after 30% US withholding) ÷
  prior trading day's closing price`. Source: SEC filing / issuer dividend record, or
  xStocks' public API if live.
- **Fact (b) — actual multiplier ratio:** `new_multiplier ÷ old_multiplier − 1`, read
  directly from a `RebaseEvents` row — the mint's own `UpdateMultiplierData` instruction
  data, read via Solana RPC.

## The three states

| State | Enum value | Trigger |
|---|---|---|
| **Verified** | `verified` | Facts (a) and (b) both exist, are stored with source and timestamp, and `\|expected_ratio − actual_ratio\| <= tolerance` (default **0.01 percentage points**, a named constant — `DEFAULT_TOLERANCE_PP` — never a magic number, configurable per environment via `VERIFICATION_TOLERANCE_PP`). |
| **Discrepancy Flagged** | `discrepancy_flagged` | Both facts exist and are stored, but `\|expected_ratio − actual_ratio\| > tolerance`. |
| **Reference Unavailable** | `reference_unavailable` | A `RebaseEvents` row exists (a real on-chain multiplier change was detected) but no `CorporateActionReferences` row could be fetched or sourced for it. This is a third, explicit state — **not** a variant of either Verified or Flagged. The UI must show this state literally, never silently substitute a placeholder, and never render a green/red verdict when this state is active. |

`computeStatus(expected, actual, tolerance)` in `src/shared/types.ts` is the sole place
any of these three values is produced. `expected === null` always and only yields
`reference_unavailable`, regardless of what `actual` is — a missing reference is never
treated as a zero, a default match, or silently dropped.

## A wallet's personal impact is derived display, never a third input

Once the mint-level verdict above is decided, a specific wallet's "your balance should
have changed by X, actually changed by Y" is computed by multiplying that wallet's own
raw token balance (held at the event's effective time) by the expected and actual
multiplier ratios respectively. This arithmetic:

- **Never feeds back into the Verified/Flagged decision.** It only personalizes the
  display of a decision already made at the mint level.
- **Is never persisted in `VerificationRecords`** as if it were an independent fact.
- **Is always visually distinguished** in the UI from the two source facts, and always
  carries a `derived: true` flag in API responses, so it can never be mistaken for a
  third independent source.

Two different wallets holding the same mint always see the identical status, computed
once and looked up — never re-derived per wallet.

## Never

- An LLM, a UI heuristic, or a single number never asserts a match or mismatch.
- Every badge traces to exactly two stored, independently-sourced facts a user can click
  to inspect.
- A per-wallet balance is never counted as one of those two facts.
- `source_mode` (`live` | `manual`) is never null, never omitted from the UI, and never
  silently substituted — if a real reference can't be fetched live, the system says so
  explicitly ("Reference Unavailable" / "Manually Sourced"), never a silent placeholder.
