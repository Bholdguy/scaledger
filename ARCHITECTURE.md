# Scaledger — ARCHITECTURE

Companion to `PRD.md`. Describes the System 1 / System 2 split, the five tables, and the exact path a rebase event takes from detection to a stored, lookup-able `VerificationRecords` row. Field names here are identical to `PRD.md` Section 6 — this document does not introduce new naming.

---

## 1. System split

**System 1 — wallet dashboard (reference workload).** Wallet-connect, current-holdings display. Reads `Wallets`, `Holdings`. Touches Solana RPC only for current balances. Contains zero verification logic — it is a consumer of System 2's output, never a producer.

**System 2 — Scaledger verification engine (the product).** Everything that detects a rebase, fetches a reference, computes ratios, compares, and records a verdict. Operates **per mint**, independent of which wallet is looking. System 1 queries System 2's stored output; System 2 never queries System 1 to decide anything.

```
┌─────────────────────────┐         ┌──────────────────────────────────────────┐
│  System 1: Dashboard     │         │  System 2: Verification Engine            │
│                          │         │                                            │
│  Wallet connect          │  reads  │  RebaseDetectionService (Step 3)          │
│  Holdings list  ────────►│◄────────│  CorporateActionReferenceService (Step 4) │
│  Verification badge      │  looks  │  computeExpectedRatio/computeActualRatio  │
│  Ledger view             │  up     │  computeStatus  (Step 5)                  │
│  Export button           │         │  VerificationRecords store (per mint)     │
└─────────────────────────┘         └──────────────────────────────────────────┘
```

The one place these systems touch is the lookup: `GET /api/verification?mint=` (Step 6) and `GET /api/verification/history?wallet=` (Step 9). Both are read-only lookups against System 2's already-computed, per-mint records — neither endpoint triggers a fresh Detect/Fetch/Compute cycle on a request from System 1. Detect/Fetch/Compute run on their own schedule (manual "Run Check" trigger for the hackathon build, not a cron), and write once.

---

## 2. Data model (authoritative — matches PRD.md Section 6 verbatim)

```
Wallets
  address            text PK
  connected_at       timestamptz

Holdings
  wallet             text FK -> Wallets.address
  mint               text          -- e.g. STRCx mint address
  ticker             text          -- e.g. "STRCx"
  balance            numeric       -- current uiAmount, refreshed on dashboard load
  last_checked       timestamptz
  PRIMARY KEY (wallet, mint)

RebaseEvents
  id                     uuid PK
  mint                   text          -- NOT wallet. One row per mint-level event.
  tx_signature           text unique   -- the UpdateMultiplierData transaction signature
  old_multiplier         numeric
  new_multiplier         numeric
  effective_timestamp    timestamptz
  detected_at            timestamptz

CorporateActionReferences
  id                  uuid PK
  ticker              text
  action_type         text          -- 'dividend' | 'split' | 'reverse_split'
  size                numeric       -- gross dividend per share, or split ratio
  prior_close_price   numeric       -- required by the xStocks rebase formula
  source              text          -- 'xstocks_api' | 'sec_8k' | 'issuer_dividend_page'
  source_mode         text          -- 'live' | 'manual'  (never null, never inferred)
  source_url          text
  effective_date      date

VerificationRecords
  id                              uuid PK
  rebase_event_id                 uuid FK -> RebaseEvents.id
  corporate_action_reference_id   uuid FK -> CorporateActionReferences.id  (nullable — null means Reference Unavailable)
  expected_ratio                  numeric  (nullable)
  actual_ratio                    numeric   -- new_multiplier / old_multiplier, always computable once RebaseEvents exists
  discrepancy                     numeric  (nullable)  -- |expected_ratio - actual_ratio|
  status                          text     -- VerificationStatus enum: 'verified' | 'discrepancy_flagged' | 'reference_unavailable'
  tolerance_used                  numeric
  computed_at                     timestamptz
  UNIQUE (rebase_event_id, corporate_action_reference_id)
```

**No wallet column anywhere in `RebaseEvents` or `VerificationRecords`.** This is intentional and load-bearing — see PRD.md Section 1 and the corrections logged in `DECISIONS.md`. A wallet's personal impact is computed at request time in the API layer (Section 4 below) and is never persisted as if it were an independent input.

---

## 3. End-to-end flow: a rebase event from detection to a stored, lookup-able record

```
 1. RebaseDetectionService.findMultiplierUpdates(STRCx_mint, authority)
    │  Solana RPC: getAccountInfo(mint) → resolve authority
    │  Solana RPC: getSignaturesForAddress(authority) + getTransaction(sig) per signature
    │    — scans the AUTHORITY's signature history, not the mint's; see DECISIONS.md D10.
    │    A TransferChecked instruction references the mint account for decimal
    │    verification, so the mint's OWN signature history includes every ordinary
    │    trade (tens of signatures per minute on an actively-traded mint) — walking it
    │    back far enough to reach a real historical rebase is not feasible on
    │    rate-limited public RPC. The authority's own signature history is far smaller
    │    (it only signs its own transactions) and detection semantics are unchanged:
    │    a candidate only counts if its decoded instruction is UpdateMultiplierData
    │    AND its account list includes this specific mint.
    │  Filter: instruction.program == Token-2022, instruction.type == 'UpdateMultiplierData',
    │          instruction's accounts include the target mint
    ▼
 2. INSERT RebaseEvents (mint, tx_signature, old_multiplier, new_multiplier, effective_timestamp)
    │  One row. No wallet involved. Idempotent on tx_signature (unique constraint).
    ▼
 3. CorporateActionReferenceService.fetch(ticker, effective_date)
    │  Try: xStocks public API (if Day-1 spike marked it usable)
    │  Else: manual reference table, source_mode = 'manual', source_url = SEC 8-K / issuer page
    │  Also resolves prior_close_price (same sourcing precedence)
    ▼
 4. INSERT CorporateActionReferences (ticker, action_type, size, prior_close_price, source, source_mode, source_url, effective_date)
    │  If this fetch fails entirely: skip to step 6 with corporate_action_reference_id = null.
    ▼
 5. expected_ratio = computeExpectedRatio(reference)          -- net_dividend_after_withholding / prior_close_price
    actual_ratio   = computeActualRatio(rebaseEvent)           -- new_multiplier / old_multiplier
    status         = computeStatus(expected_ratio, actual_ratio, TOLERANCE)
    ▼
 6. INSERT VerificationRecords (rebase_event_id, corporate_action_reference_id, expected_ratio,
                                 actual_ratio, discrepancy, status, tolerance_used)
    │  Written ONCE for this (rebase_event_id, corporate_action_reference_id) pair.
    ▼
 7. Any wallet holding this mint, at any later time:
      GET /api/verification?mint=<mint>
        → SELECT latest VerificationRecords row WHERE rebase_event_id IN (SELECT id FROM RebaseEvents WHERE mint = ?)
        → returns the SAME row regardless of which wallet asked
      GET /api/holdings/:wallet/:mint/impact
        → reads that wallet's raw balance at RebaseEvents.effective_timestamp (one historical RPC read,
          or reads Holdings.balance as an approximation if pre-event history isn't available)
        → personal_expected_change = balance × expected_ratio
        → personal_actual_change   = balance × actual_ratio
        → returned as a clearly-labeled DERIVED field, never written back to VerificationRecords
```

**Why this shape matters:** step 6 runs exactly once per real-world corporate action, no matter how many wallets later ask about it. Step 7 never re-runs steps 1–6. This is what makes the "computed once per mint, not per wallet" invariant (PRD.md Section 1) a structural property of the system rather than a promise in a comment.

---

## 4. API surface

| Endpoint | Reads | Writes | Notes |
|---|---|---|---|
| `GET /api/holdings?wallet=` | Solana RPC (`getTokenAccountsByOwner`) | `Wallets`, `Holdings` | System 1. No verification logic. |
| `POST /api/verification/run?mint=` | Steps 1–6 above | `RebaseEvents`, `CorporateActionReferences`, `VerificationRecords` | Manual trigger for the hackathon build — no background scheduler. Idempotent: re-running against an already-detected event does not create duplicate rows (unique constraints handle this). |
| `GET /api/verification?mint=` | `VerificationRecords` (+ joined `RebaseEvents`, `CorporateActionReferences`) | — | Pure lookup. Never triggers `run`. |
| `GET /api/holdings/:wallet/:mint/impact` | `Holdings.balance` (or historical RPC read), `VerificationRecords` | — | Derived-arithmetic endpoint. Response includes a `derived: true` flag on the personal-impact fields so the frontend can visually distinguish them from the two source facts. |
| `GET /api/verification/history?wallet=` | `Holdings` joined to `VerificationRecords` via mint | — | Step 9. Read-only join, no re-computation. |
| `GET /api/verification/:id/export?format=` | `VerificationRecords` full join | — | Step 8. Serialization only. |
| `GET /api/holdings` (disclosure field) | `IssuerDisclosures` config | — | Step 7. Static, hand-populated. |

---

## 5. Why a manual `run` trigger, not a background job

The hackathon build has one demo ticker and a four-day window. A scheduler polling Solana RPC on an interval adds operational surface (retry/backoff state, a process that needs to stay alive during the demo) with no payoff — the judge demo needs one deterministic run, not continuous monitoring. `POST /api/verification/run` is called explicitly (by the "Run Check" button in Step 6, or by the seed script that populates the fixture for Step 10). A real production version would replace this with an event listener on the mint account; that's out of scope per PRD.md Section 4.

---

## 6. Fixture / demo-mode architecture (Step 10)

`demo` mode does not add a parallel code path. `RebaseDetectionService` and `CorporateActionReferenceService` both take an injected data source (`SolanaRpcSource` in live mode, `FixtureSource` in demo mode) behind the same interface. `computeExpectedRatio`, `computeActualRatio`, and `computeStatus` never know which mode is active — they operate on whatever `RebaseEvents`/`CorporateActionReferences` rows exist, live or fixture-seeded. This is what makes the Step 10 Definition of Done ("same code paths as the live path") an architectural fact, not a testing claim.
