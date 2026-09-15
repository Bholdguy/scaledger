import { describe, it, expect } from 'vitest';
import { decodeUpdateMultiplierInstruction } from '../src/server/rebaseDetectionService.js';
import { TOKEN_2022_PROGRAM_ID, TokenInstruction, updateMultiplierData } from '@solana/spl-token';

const TOKEN_2022 = TOKEN_2022_PROGRAM_ID.toBase58();

function buildUpdateMultiplierData(multiplier: number, effectiveTimestamp: bigint): Buffer {
  const data = Buffer.alloc(updateMultiplierData.span);
  updateMultiplierData.encode(
    {
      instruction: TokenInstruction.ScaledUiAmountExtension,
      scaledUiAmountInstruction: 1, // UpdateMultiplier
      multiplier,
      effectiveTimestamp,
    },
    data,
  );
  return data;
}

function buildTransferCheckedData(amount: bigint, decimals: number): Buffer {
  // TransferChecked layout: [instruction:u8][amount:u64][decimals:u8]
  const data = Buffer.alloc(10);
  data.writeUInt8(TokenInstruction.TransferChecked, 0);
  data.writeBigUInt64LE(amount, 1);
  data.writeUInt8(decimals, 9);
  return data;
}

function buildTransferData(amount: bigint): Buffer {
  // Transfer layout: [instruction:u8][amount:u64]
  const data = Buffer.alloc(9);
  data.writeUInt8(TokenInstruction.Transfer, 0);
  data.writeBigUInt64LE(amount, 1);
  return data;
}

describe('decodeUpdateMultiplierInstruction — structural decoder', () => {
  it('assertion 1 (inclusion): decodes a real UpdateMultiplierData instruction', () => {
    const data = buildUpdateMultiplierData(1.0808929977256367, 1789432200n);
    const result = decodeUpdateMultiplierInstruction(TOKEN_2022, data);
    expect(result).not.toBeNull();
    expect(result!.newMultiplier).toBeCloseTo(1.0808929977256367, 12);
    expect(result!.effectiveTimestamp).toBe(1789432200n);
  });

  it('assertion 2(b) (structural exclusion): a TransferChecked instruction is never classified as UpdateMultiplierData, regardless of program/signer context', () => {
    const data = buildTransferCheckedData(231901n, 8);
    const result = decodeUpdateMultiplierInstruction(TOKEN_2022, data);
    expect(result).toBeNull();
  });

  it('assertion 2(b): a plain Transfer instruction is never classified as UpdateMultiplierData', () => {
    const data = buildTransferData(1_000_000n);
    const result = decodeUpdateMultiplierInstruction(TOKEN_2022, data);
    expect(result).toBeNull();
  });

  it('rejects instructions from a different program entirely, even with matching-looking bytes', () => {
    const data = buildUpdateMultiplierData(1.05, 1700000000n);
    const result = decodeUpdateMultiplierInstruction('11111111111111111111111111111111', data);
    expect(result).toBeNull();
  });

  it('rejects truncated/malformed instruction data rather than throwing', () => {
    const result = decodeUpdateMultiplierInstruction(TOKEN_2022, Buffer.from([43, 1, 0, 0]));
    expect(result).toBeNull();
  });

  it('rejects the correct outer discriminant with a wrong sub-instruction (e.g. Initialize, not UpdateMultiplier)', () => {
    const data = Buffer.alloc(18);
    data.writeUInt8(TokenInstruction.ScaledUiAmountExtension, 0);
    data.writeUInt8(0, 1); // Initialize, not UpdateMultiplier
    const result = decodeUpdateMultiplierInstruction(TOKEN_2022, data);
    expect(result).toBeNull();
  });
});
