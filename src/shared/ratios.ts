import type { CorporateActionReference } from '../server/corporateActionReferenceService.js';
import type { RebaseEvent } from '../server/rebaseDetectionService.js';

/** Withholding rate xStocks' documented formula applies to US-source dividends. */
export const US_WITHHOLDING_RATE = 0.3;

/**
 * Step 5 (Compute). Expected multiplier ratio as a percentage, per xStocks' documented
 * formula: net dividend per share (after 30% US withholding) ÷ prior trading day's
 * closing price. Returns a percentage-point value (e.g. 0.359601 for 0.359601%) so it's
 * directly comparable to `computeActualRatio`'s output and to `DEFAULT_TOLERANCE_PP`.
 */
export function computeExpectedRatio(reference: CorporateActionReference): number {
  const netDividend = reference.size * (1 - US_WITHHOLDING_RATE);
  return (netDividend / reference.priorClosePrice) * 100;
}

/**
 * Step 5 (Compute). Actual multiplier ratio as a percentage: new_multiplier / old_multiplier
 * read directly from the mint's own UpdateMultiplierData instruction — see CONTRACT.md Fact (b).
 */
export function computeActualRatio(event: RebaseEvent): number {
  return (event.newMultiplier / event.oldMultiplier - 1) * 100;
}
