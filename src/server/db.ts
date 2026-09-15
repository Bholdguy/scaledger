import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';

// Loaded via createRequire rather than a static `import ... from 'node:sqlite'` because
// the Vite/vitest toolchain's bundled builtin-module list predates node:sqlite and fails
// to externalize it statically, even with ssr.external configured.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
type DatabaseSync = InstanceType<typeof import('node:sqlite').DatabaseSync>;

/**
 * Schema matches ARCHITECTURE.md Section 2 verbatim. RebaseEvents and
 * VerificationRecords are keyed by mint / (rebase_event_id, corporate_action_reference_id)
 * respectively — never by wallet. See CONTRACT.md and DECISIONS.md D1/D2.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS Wallets (
  address       TEXT PRIMARY KEY,
  connected_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Holdings (
  wallet        TEXT NOT NULL REFERENCES Wallets(address),
  mint          TEXT NOT NULL,
  ticker        TEXT NOT NULL,
  balance       REAL NOT NULL,
  last_checked  TEXT NOT NULL,
  PRIMARY KEY (wallet, mint)
);

CREATE TABLE IF NOT EXISTS RebaseEvents (
  id                    TEXT PRIMARY KEY,
  mint                  TEXT NOT NULL,
  tx_signature          TEXT NOT NULL UNIQUE,
  old_multiplier        REAL NOT NULL,
  new_multiplier        REAL NOT NULL,
  effective_timestamp   TEXT NOT NULL,
  detected_at           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS CorporateActionReferences (
  id                  TEXT PRIMARY KEY,
  ticker              TEXT NOT NULL,
  action_type         TEXT NOT NULL,
  size                REAL NOT NULL,
  prior_close_price   REAL NOT NULL,
  source              TEXT NOT NULL,
  source_mode         TEXT NOT NULL CHECK (source_mode IN ('live', 'manual')),
  source_url          TEXT NOT NULL,
  effective_date      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS VerificationRecords (
  id                              TEXT PRIMARY KEY,
  rebase_event_id                 TEXT NOT NULL REFERENCES RebaseEvents(id),
  corporate_action_reference_id   TEXT REFERENCES CorporateActionReferences(id),
  expected_ratio                  REAL,
  actual_ratio                    REAL NOT NULL,
  discrepancy                     REAL,
  status                          TEXT NOT NULL CHECK (status IN ('verified', 'discrepancy_flagged', 'reference_unavailable')),
  tolerance_used                  REAL NOT NULL,
  computed_at                     TEXT NOT NULL,
  UNIQUE (rebase_event_id, corporate_action_reference_id)
);

CREATE TABLE IF NOT EXISTS IssuerDisclosures (
  ticker      TEXT PRIMARY KEY,
  tag_text    TEXT NOT NULL,
  source_url  TEXT NOT NULL
);
`;

let db: DatabaseSync | null = null;

export function getDb(path: string = process.env.DATABASE_URL ?? './data/scaledger.db'): DatabaseSync {
  if (db) return db;
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

export function closeDb(): void {
  db?.close();
  db = null;
}
