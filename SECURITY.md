# Scaledger — SECURITY

Companion to `PRD.md` and `ARCHITECTURE.md`. Covers credential handling, frontend/backend exposure boundary, and Solana RPC pagination/rate-limit handling.

---

## 1. Credentials — server-side only, never shipped to the frontend

| Credential | Used by | Where it lives | Never appears in |
|---|---|---|---|
| Solana RPC endpoint (if a paid/rate-limited provider like Helius/QuickNode is used instead of public RPC) | `RebaseDetectionService`, System 1's `/api/holdings` | Backend `.env`, read once at process start | Any frontend bundle, any client-visible network request. All RPC calls are proxied through the backend — the browser never holds an RPC URL with an embedded API key. |
| xStocks API key (only if the Day-1 spike confirms authenticated endpoints are needed — public endpoints per research need none) | `CorporateActionReferenceService` | Backend `.env` | Frontend. The frontend calls Scaledger's own `/api/*` routes, never `api.xstocks.fi` directly. |
| Backpack Securities ED25519 keypair (stretch-only, Step 7) | `IssuerDisclosureService` (Backpack branch) | Backend `.env`, private key never logged, never returned in any API response | Frontend, logs, exported CSV/JSON records, error messages. If a request-signing error occurs, the error surfaced to the client is a generic "disclosure unavailable," never the raw signing exception (which could leak key material or the request body it signed). |
| Postgres/SQLite connection string | Backend process | Backend `.env` | Frontend, client-visible error messages (a DB connection failure returns a generic 500, not the connection string). |

**Rule:** every credential in `.env.example` is read by exactly one named backend service (documented in the file itself). If a value would need to reach the browser to make a feature work, that feature is redesigned to proxy through the backend instead — this product never has a reason to expose a third-party API key client-side, because every external call (RPC, xStocks, Backpack) is made on behalf of a lookup the backend already owns.

---

## 2. Frontend/backend exposure boundary

**Frontend holds:** the connected wallet's public address (from wallet-adapter, already public by nature of being on-chain), and whatever the backend's `/api/*` responses return (ticker names, ratios, statuses, source URLs, timestamps — all either public on-chain data or public disclosure documents).

**Frontend never holds:** any RPC provider key, any xStocks/Backpack API key, any database credential, any Backpack ED25519 private key.

**Wallet-adapter note:** Scaledger never requests a signing capability from the connected wallet. This is a read-only verification tool (PRD.md Section 4) — wallet-adapter is used only to obtain the public address for the `getTokenAccountsByOwner` query. No `signTransaction`/`signMessage` call is ever made, so there is no signing-phishing surface to defend against in the first place.

---

## 3. Solana RPC pagination and rate-limit handling

Two RPC call sites in this build have unbounded result sizes and must be paginated defensively:

**`getSignaturesForAddress` (Step 3, scanning the multiplier-update authority's history — DECISIONS.md D10):** paginated via the `before` cursor, page size capped at 1000 (RPC max). Originally specified against the mint's own history; changed during implementation because a Token-2022 `TransferChecked` instruction references the mint account for every ordinary trade, making the mint's signature history dominated by trading volume (tens of signatures per minute observed on the live STRCx mint) rather than rebase events — infeasible to walk back even a few weeks on rate-limited public RPC. The authority's own signature history is far smaller (it only signs its own transactions) and detection semantics are unchanged. For the hackathon build, the scan is bounded to a configurable lookback window (`RPC_SCAN_LOOKBACK_DAYS`, default 400) rather than walking to genesis. Each page's results are checked before fetching the next page; the loop terminates early once results predate the lookback window.

**`getTokenAccountsByOwner` (Step 2, dashboard holdings):** a single wallet's token accounts are bounded by how many distinct SPL mints it holds — not unbounded in practice, but the response is still filtered server-side against the allowlist before being returned to the frontend, so an unusually large wallet doesn't push an oversized, unfiltered payload to the client.

**Rate limiting:** public Solana RPC (`api.mainnet-beta.solana.com`) enforces per-IP rate limits that are easy to hit when walking transaction history. Handling:
- Exponential backoff with jitter on `429` responses, capped at 5 retries per call.
- `getTransaction` calls (one per candidate signature) are batched with a small concurrency limit (e.g., 5 in flight), not fired all at once — a mint with hundreds of historical signatures would otherwise trigger an immediate rate-limit wall.
- If a paid RPC provider key is configured (`SOLANA_RPC_URL` in `.env.example` pointed at Helius/QuickNode/etc.), the same backoff logic applies — provider-specific rate limits are typically higher but not infinite, and the code does not assume unlimited throughput.
- A scan that fails after exhausting retries surfaces as an explicit backend error ("could not complete rebase scan — RPC rate limited, retry later"), never a silent empty result that could be misread as "no rebase found."

---

## 4. What happens if a wallet's transaction history is unusually large

Step 2's dashboard call (`getTokenAccountsByOwner`) is not the concern — that's bounded by the wallet's current holdings, typically a handful of accounts. The concern is Step 3's mint-level scan, which is already addressed above (bounded lookback window, paginated, rate-limit-aware) and is **wallet-independent** — it runs once per mint regardless of how many or how few wallets hold it, so a large or active wallet has no effect on this scan's cost. The only wallet-scoped RPC read in the entire pipeline is the single historical-balance lookup for the derived personal-impact display (Step 6/`ARCHITECTURE.md` Section 4) — one point read, not a history walk, so it carries no pagination concern of its own.

---

## 5. Input validation at system boundaries

Per the project's general engineering guidance (validate only at boundaries, trust internal code): the two external boundaries are (a) the wallet address supplied via wallet-adapter to `/api/holdings` and `/api/verification/history`, and (b) the `mint` query parameter to `/api/verification`. Both are validated as well-formed Solana base58 public keys before being used in any RPC call or DB query — malformed input is rejected with a 400 before it reaches RPC or SQL, closing off both wasted RPC calls on garbage input and any injection surface via string-built queries (parameterized queries are used regardless, as defense in depth, not as the only check).
