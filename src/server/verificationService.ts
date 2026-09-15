import { getDb } from './db.js';
import { computeStatus, DEFAULT_TOLERANCE_PP, VerificationStatus } from '../shared/types.js';
import { computeExpectedRatio, computeActualRatio } from '../shared/ratios.js';
import type { RebaseEvent } from './rebaseDetectionService.js';
import type { CorporateActionReference } from './corporateActionReferenceService.js';
import { randomUUID } from 'node:crypto';

export interface VerificationRecord {
  id: string;
  rebaseEventId: string;
  corporateActionReferenceId: string | null;
  expectedRatio: number | null;
  actualRatio: number;
  discrepancy: number | null;
  status: VerificationStatus;
  toleranceUsed: number;
  computedAt: string;
}

/**
 * Step 5 (Compute/Compare). Computed once per (rebase_event_id, corporate_action_reference_id)
 * pair and looked up thereafter — never re-derived per wallet. See CONTRACT.md,
 * ARCHITECTURE.md Section 3 step 5-6, DECISIONS.md D2. `reference === null` means no
 * CorporateActionReferences row could be sourced — status is reference_unavailable,
 * never a placeholder.
 */
export function computeAndRecordVerification(
  event: RebaseEvent,
  reference: CorporateActionReference | null,
  tolerancePp: number = DEFAULT_TOLERANCE_PP,
): VerificationRecord {
  const db = getDb();

  const existing = db
    .prepare(
      `SELECT * FROM VerificationRecords WHERE rebase_event_id = ? AND corporate_action_reference_id IS ?`,
    )
    .get(event.id, reference?.id ?? null) as VerificationRecordRow | undefined;
  if (existing) return rowToRecord(existing);

  const actualRatio = computeActualRatio(event);
  const expectedRatio = reference ? computeExpectedRatio(reference) : null;
  const discrepancy = expectedRatio === null ? null : Math.abs(expectedRatio - actualRatio);
  const status = computeStatus(expectedRatio, actualRatio, tolerancePp);

  const record: VerificationRecord = {
    id: randomUUID(),
    rebaseEventId: event.id,
    corporateActionReferenceId: reference?.id ?? null,
    expectedRatio,
    actualRatio,
    discrepancy,
    status,
    toleranceUsed: tolerancePp,
    computedAt: new Date().toISOString(),
  };

  db.prepare(
    `INSERT INTO VerificationRecords
       (id, rebase_event_id, corporate_action_reference_id, expected_ratio, actual_ratio, discrepancy, status, tolerance_used, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.id,
    record.rebaseEventId,
    record.corporateActionReferenceId,
    record.expectedRatio,
    record.actualRatio,
    record.discrepancy,
    record.status,
    record.toleranceUsed,
    record.computedAt,
  );

  return record;
}

interface VerificationRecordRow {
  id: string;
  rebase_event_id: string;
  corporate_action_reference_id: string | null;
  expected_ratio: number | null;
  actual_ratio: number;
  discrepancy: number | null;
  status: VerificationStatus;
  tolerance_used: number;
  computed_at: string;
}

function rowToRecord(row: VerificationRecordRow): VerificationRecord {
  return {
    id: row.id,
    rebaseEventId: row.rebase_event_id,
    corporateActionReferenceId: row.corporate_action_reference_id,
    expectedRatio: row.expected_ratio,
    actualRatio: row.actual_ratio,
    discrepancy: row.discrepancy,
    status: row.status,
    toleranceUsed: row.tolerance_used,
    computedAt: row.computed_at,
  };
}

/**
 * The two source facts (CONTRACT.md) plus the derived-not-a-third-fact display fields a
 * user can click to inspect, per PRD.md Step 6's DoD ("UI must literally render
 * source_mode... never omit it"). `reference_unavailable` records have all
 * reference-side fields null (LEFT JOIN — never fabricated).
 */
export interface VerificationRecordWithSources extends VerificationRecord {
  txSignature: string;
  effectiveTimestamp: string;
  dividendSize: number | null;
  priorClosePrice: number | null;
  source: string | null;
  sourceMode: 'live' | 'manual' | null;
  sourceUrl: string | null;
}

interface VerificationRecordWithSourcesRow extends VerificationRecordRow {
  tx_signature: string;
  effective_timestamp: string;
  dividend_size: number | null;
  prior_close_price: number | null;
  source: string | null;
  source_mode: 'live' | 'manual' | null;
  source_url: string | null;
}

/** Pure lookup — never triggers a fresh compute. See ARCHITECTURE.md Section 4. */
export function getVerificationForMint(mint: string): VerificationRecordWithSources | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT vr.*, re.tx_signature, re.effective_timestamp,
              car.size AS dividend_size, car.prior_close_price, car.source, car.source_mode, car.source_url
       FROM VerificationRecords vr
       JOIN RebaseEvents re ON re.id = vr.rebase_event_id
       LEFT JOIN CorporateActionReferences car ON car.id = vr.corporate_action_reference_id
       WHERE re.mint = ?
       ORDER BY re.effective_timestamp DESC
       LIMIT 1`,
    )
    .get(mint) as VerificationRecordWithSourcesRow | undefined;
  if (!row) return null;
  return {
    ...rowToRecord(row),
    txSignature: row.tx_signature,
    effectiveTimestamp: row.effective_timestamp,
    dividendSize: row.dividend_size,
    priorClosePrice: row.prior_close_price,
    source: row.source,
    sourceMode: row.source_mode,
    sourceUrl: row.source_url,
  };
}
