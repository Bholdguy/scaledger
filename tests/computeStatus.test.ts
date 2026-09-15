import { describe, it, expect } from 'vitest';
import {
  computeStatus,
  VerificationStatus,
  DEFAULT_TOLERANCE_PP,
} from '../src/shared/types.js';

describe('computeStatus', () => {
  const cases: Array<{
    name: string;
    expected: number | null;
    actual: number;
    tolerance?: number;
    want: VerificationStatus;
  }> = [
    {
      name: 'exact match -> verified',
      expected: 0.5,
      actual: 0.5,
      want: VerificationStatus.Verified,
    },
    {
      name: 'small delta under tolerance -> verified',
      expected: 0.5,
      actual: 0.505,
      want: VerificationStatus.Verified,
    },
    {
      name: 'delta exactly at tolerance boundary -> verified (not over)',
      expected: 0,
      actual: 0.01,
      want: VerificationStatus.Verified,
    },
    {
      name: 'delta over tolerance -> discrepancy_flagged',
      expected: 0.359601,
      actual: 0.513716,
      want: VerificationStatus.DiscrepancyFlagged,
    },
    {
      name: 'expected null -> reference_unavailable regardless of actual size',
      expected: null,
      actual: 0.513716,
      want: VerificationStatus.ReferenceUnavailable,
    },
    {
      name: 'expected null with actual = 0 -> still reference_unavailable, never verified',
      expected: null,
      actual: 0,
      want: VerificationStatus.ReferenceUnavailable,
    },
    {
      name: 'negative actual ratio (a decrease) with matching magnitude -> verified',
      expected: -0.2,
      actual: -0.201,
      want: VerificationStatus.Verified,
    },
    {
      name: 'custom tighter tolerance turns an otherwise-verified delta into flagged',
      expected: 0.5,
      actual: 0.505,
      tolerance: 0.001,
      want: VerificationStatus.DiscrepancyFlagged,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const got =
        c.tolerance === undefined
          ? computeStatus(c.expected, c.actual)
          : computeStatus(c.expected, c.actual, c.tolerance);
      expect(got).toBe(c.want);
    });
  }

  it('uses DEFAULT_TOLERANCE_PP (0.01) when no tolerance is passed', () => {
    expect(DEFAULT_TOLERANCE_PP).toBe(0.01);
    expect(computeStatus(0, 0.0099)).toBe(VerificationStatus.Verified);
    expect(computeStatus(0, 0.0101)).toBe(VerificationStatus.DiscrepancyFlagged);
  });
});
