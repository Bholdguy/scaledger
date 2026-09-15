/**
 * Shared types for Scaledger. This module is the single source of truth for
 * `VerificationStatus` — no other code path may invent a fourth state or infer
 * status from anything other than `computeStatus`'s output. See CONTRACT.md.
 */

export const VerificationStatus = {
  Verified: 'verified',
  DiscrepancyFlagged: 'discrepancy_flagged',
  ReferenceUnavailable: 'reference_unavailable',
} as const;

export type VerificationStatus =
  (typeof VerificationStatus)[keyof typeof VerificationStatus];

/** Percentage-point tolerance below which expected/actual ratios are treated as matching. */
export const DEFAULT_TOLERANCE_PP = 0.01;

/**
 * The sole place `VerificationStatus` is derived. `expected`/`actual` are
 * percentage-point ratios (e.g. 0.513716 for a 0.513716% multiplier increase).
 * `expected === null` means no CorporateActionReferences row could be sourced
 * for this rebase event — this is `reference_unavailable`, never a fallback
 * zero or a silently-substituted placeholder, regardless of what `actual` is.
 */
export function computeStatus(
  expected: number | null,
  actual: number,
  tolerancePp: number = DEFAULT_TOLERANCE_PP,
): VerificationStatus {
  if (expected === null) {
    return VerificationStatus.ReferenceUnavailable;
  }
  const discrepancy = Math.abs(expected - actual);
  return discrepancy > tolerancePp
    ? VerificationStatus.DiscrepancyFlagged
    : VerificationStatus.Verified;
}
