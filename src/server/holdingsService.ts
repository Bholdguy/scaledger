import { PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { getConnection } from './solana.js';
import { withRetry } from './rpcRetry.js';
import { isAllowlistedMint, tickerForMint } from '../shared/allowlist.js';
import { getDb } from './db.js';
import { getIssuerDisclosure, type IssuerDisclosure } from './issuerDisclosureService.js';

export interface Holding {
  mint: string;
  ticker: string;
  balance: number;
  lastChecked: string;
  disclosure: IssuerDisclosure | null;
}

/**
 * Step 2 (System 1). Reads the wallet's Token-2022 accounts live via RPC, filters to the
 * mint allowlist, and upserts Wallets/Holdings. Contains zero verification logic —
 * System 1 never decides Verified/Flagged; see ARCHITECTURE.md Section 1.
 */
export async function getHoldingsForWallet(walletAddress: string): Promise<Holding[]> {
  const owner = new PublicKey(walletAddress);
  const connection = getConnection();

  const { value: tokenAccounts } = await withRetry(() =>
    connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }),
  );

  const holdings: Holding[] = [];
  for (const { account } of tokenAccounts) {
    const info = account.data.parsed.info;
    const mint: string = info.mint;
    if (!isAllowlistedMint(mint)) continue;
    const ticker = tickerForMint(mint)!;
    const uiAmount: number = info.tokenAmount.uiAmount ?? 0;
    holdings.push({
      mint,
      ticker,
      balance: uiAmount,
      lastChecked: new Date().toISOString(),
      disclosure: getIssuerDisclosure(ticker),
    });
  }

  persistHoldings(walletAddress, holdings);
  return holdings;
}

function persistHoldings(walletAddress: string, holdings: Holding[]): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO Wallets (address, connected_at) VALUES (?, ?)
     ON CONFLICT(address) DO NOTHING`,
  ).run(walletAddress, new Date().toISOString());

  const upsert = db.prepare(
    `INSERT INTO Holdings (wallet, mint, ticker, balance, last_checked) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(wallet, mint) DO UPDATE SET balance = excluded.balance, last_checked = excluded.last_checked`,
  );
  for (const h of holdings) {
    upsert.run(walletAddress, h.mint, h.ticker, h.balance, h.lastChecked);
  }
}
