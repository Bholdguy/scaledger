import type { DataSource } from './dataSource.js';
import { recordRebaseEvent } from './rebaseDetectionService.js';
import { recordCorporateActionReference } from './corporateActionReferenceService.js';
import { computeAndRecordVerification, type VerificationRecord } from './verificationService.js';
import { tickerForMint } from '../shared/allowlist.js';

/**
 * Runs Detect -> Fetch -> Compute -> Compare -> Flag once for a mint's latest rebase
 * event, via `dataSource` (live RPC or the frozen fixture — ARCHITECTURE.md Section 6).
 * Idempotent: re-running against an already-detected event does not create duplicate
 * rows (unique constraints on tx_signature and (rebase_event_id, corporate_action_reference_id)).
 */
export async function runVerificationPipeline(
  dataSource: DataSource,
  mint: string,
): Promise<VerificationRecord[]> {
  const ticker = tickerForMint(mint);
  if (!ticker) throw new Error(`mint not in allowlist: ${mint}`);

  const events = await dataSource.getRebaseEvents(mint);
  const records: VerificationRecord[] = [];

  for (const event of events) {
    recordRebaseEvent(event);
    const reference = await dataSource.getCorporateActionReference(
      ticker,
      event.effectiveTimestamp.slice(0, 10),
    );
    if (reference) recordCorporateActionReference(reference);
    records.push(computeAndRecordVerification(event, reference));
  }

  return records;
}
