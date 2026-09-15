import { getDb } from './db.js';

export interface IssuerDisclosure {
  ticker: string;
  tagText: string;
  sourceUrl: string;
}

/**
 * Step 7. Hand-transcribed from the real, fetched Backed Finance factsheet PDF
 * (documents.backed.fi/backed-assets-factsheet-STRCx.pdf, "Data as of September 14, 2026")
 * — not paraphrased from general knowledge of tokenized stocks. See DECISIONS.md D5.
 * Source fields transcribed verbatim from the factsheet's "Product Details" /
 * "Underlying Information" tables: Issuer = Backed Assets (JE) Limited; Underlying =
 * "Strategy Variable Rate Perpetual Stretch Prf Shs Series A" (STRC) — a preferred stock
 * tracker, not direct equity in Strategy Inc.
 */
const DISCLOSURES: IssuerDisclosure[] = [
  {
    ticker: 'STRCx',
    tagText:
      'Tracker of Strategy Inc.’s Variable Rate Perpetual Stretch Preferred Stock (STRC, Series A) — issued by Backed Assets (JE) Limited, a Jersey SPV, not direct equity in Strategy Inc.',
    sourceUrl: 'https://documents.backed.fi/backed-assets-factsheet-STRCx.pdf',
  },
];

export function getIssuerDisclosure(ticker: string): IssuerDisclosure | null {
  return DISCLOSURES.find((d) => d.ticker === ticker) ?? null;
}

export function seedIssuerDisclosures(): void {
  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO IssuerDisclosures (ticker, tag_text, source_url) VALUES (?, ?, ?)
     ON CONFLICT(ticker) DO UPDATE SET tag_text = excluded.tag_text, source_url = excluded.source_url`,
  );
  for (const d of DISCLOSURES) {
    upsert.run(d.ticker, d.tagText, d.sourceUrl);
  }
}
