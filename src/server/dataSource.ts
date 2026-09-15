import { Connection, PublicKey } from '@solana/web3.js';
import { readFileSync } from 'node:fs';
import {
  resolveMultiplierAuthority,
  getCurrentMultiplier,
  findMultiplierUpdates,
  sequenceOldMultipliers,
  type RebaseEvent,
} from './rebaseDetectionService.js';
import { fetchCorporateActionReference, type CorporateActionReference } from './corporateActionReferenceService.js';

/**
 * Step 10 architecture (ARCHITECTURE.md Section 6): `RebaseDetectionService` and
 * `CorporateActionReferenceService` are swapped behind this interface — `computeStatus`,
 * `computeExpectedRatio`/`computeActualRatio` never know which implementation is active.
 * `demo` mode substitutes only the data source, never the compute logic.
 */
export interface DataSource {
  getRebaseEvents(mint: string): Promise<RebaseEvent[]>;
  getCorporateActionReference(ticker: string, date: string): Promise<CorporateActionReference | null>;
}

export class SolanaRpcSource implements DataSource {
  constructor(private readonly connection: Connection) {}

  async getRebaseEvents(mint: string): Promise<RebaseEvent[]> {
    const mintKey = new PublicKey(mint);
    const authority = await resolveMultiplierAuthority(this.connection, mintKey);
    const currentMultiplier = await getCurrentMultiplier(this.connection, mintKey);
    const lookbackDays = Number(process.env.RPC_SCAN_LOOKBACK_DAYS ?? 400);
    const raw = await findMultiplierUpdates(this.connection, mintKey, authority, { lookbackDays });
    return sequenceOldMultipliers(raw, currentMultiplier);
  }

  getCorporateActionReference(ticker: string, date: string): Promise<CorporateActionReference | null> {
    return fetchCorporateActionReference(ticker, date);
  }
}

interface FixtureFile {
  mint: string;
  tx_signature: string;
  old_multiplier: number;
  new_multiplier: number;
  effective_timestamp: string;
  dividend_size: number;
  prior_close_price: number;
  source_mode: 'live' | 'manual';
  source_url: string;
  effective_date?: string;
}

/**
 * Step 10 demo mode. Replays the frozen, real STRCx canonical event (DECISIONS.md D9)
 * through the same compute code as the live path — see ARCHITECTURE.md Section 6.
 */
export class FixtureSource implements DataSource {
  private readonly fixture: FixtureFile;

  constructor(fixturePath: string) {
    this.fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  }

  async getRebaseEvents(mint: string): Promise<RebaseEvent[]> {
    if (mint !== this.fixture.mint) return [];
    return [
      {
        id: `fixture-${this.fixture.tx_signature}`,
        mint: this.fixture.mint,
        txSignature: this.fixture.tx_signature,
        oldMultiplier: this.fixture.old_multiplier,
        newMultiplier: this.fixture.new_multiplier,
        effectiveTimestamp: this.fixture.effective_timestamp,
      },
    ];
  }

  async getCorporateActionReference(ticker: string): Promise<CorporateActionReference | null> {
    if (ticker !== 'STRCx') return null;
    return {
      id: `fixture-${ticker}-ref`,
      ticker,
      actionType: 'dividend',
      size: this.fixture.dividend_size,
      priorClosePrice: this.fixture.prior_close_price,
      source: 'fixture',
      sourceMode: this.fixture.source_mode,
      sourceUrl: this.fixture.source_url,
      effectiveDate: this.fixture.effective_date ?? this.fixture.effective_timestamp.slice(0, 10),
    };
  }
}
