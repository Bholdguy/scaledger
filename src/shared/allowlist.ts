/** Known xStocks/Backed Token-2022 mints this build recognizes. Starts with the demo ticker. */
export interface AllowlistEntry {
  mint: string;
  ticker: string;
}

export const MINT_ALLOWLIST: AllowlistEntry[] = [
  {
    mint: process.env.DEMO_TICKER_MINT ?? 'Xs78JED6PFZxWc2wCEPspZW9kL3Se5J7L5TChKgsidH',
    ticker: 'STRCx',
  },
];

export function tickerForMint(mint: string): string | undefined {
  return MINT_ALLOWLIST.find((e) => e.mint === mint)?.ticker;
}

export function isAllowlistedMint(mint: string): boolean {
  return MINT_ALLOWLIST.some((e) => e.mint === mint);
}
