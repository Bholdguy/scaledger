import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { getHoldingsForWallet } from '../src/server/holdingsService.js';
import { getConnection } from '../src/server/solana.js';
import { withRetry } from '../src/server/rpcRetry.js';
import { closeDb } from '../src/server/db.js';

/**
 * Step 2 DoD check: a real wallet holding STRCx renders its correct current balance,
 * sourced from a live RPC call — not a hardcoded value. Requires network access to
 * Solana mainnet; this is an integration test, not a unit test (TESTING.md/PRD.md Step 2).
 *
 * Fixture wallet found live via getProgramAccounts (memcmp on the STRCx mint), picked
 * as a real non-zero, non-authority holder — see DECISIONS.md D9 spike notes.
 */
const STRCX_MINT = 'Xs78JED6PFZxWc2wCEPspZW9kL3Se5J7L5TChKgsidH';
const FIXTURE_HOLDER = '41Mjig92SfveWPKkqis78hF3a75cpe96n1uuVuMAdkJF';

beforeAll(() => {
  process.env.DATABASE_URL = ':memory:';
});

afterAll(() => {
  closeDb();
});

describe('getHoldingsForWallet (integration, live mainnet RPC)', () => {
  it('returns STRCx with the balance an independent RPC call confirms', async () => {
    const holdings = await withRetry(() => getHoldingsForWallet(FIXTURE_HOLDER));
    const strcx = holdings.find((h) => h.mint === STRCX_MINT);
    expect(strcx).toBeDefined();
    expect(strcx!.ticker).toBe('STRCx');
    expect(strcx!.balance).toBeGreaterThan(0);

    // Independently confirm via a second, separate RPC path (not the parsed
    // getTokenAccountsByOwner call the service itself used).
    const connection = getConnection();
    const { value: rawAccounts } = await withRetry(() =>
      connection.getTokenAccountsByOwner(new PublicKey(FIXTURE_HOLDER), {
        mint: new PublicKey(STRCX_MINT),
      }),
    );
    expect(rawAccounts.length).toBeGreaterThan(0);
    const { value: balanceInfo } = await withRetry(() =>
      connection.getTokenAccountBalance(rawAccounts[0].pubkey),
    );
    expect(balanceInfo.uiAmount).toBeCloseTo(strcx!.balance, 6);
  }, 30_000);
});
