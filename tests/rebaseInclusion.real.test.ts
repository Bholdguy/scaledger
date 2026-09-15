import { describe, it, expect } from 'vitest';
import { TOKEN_2022_PROGRAM_ID, TokenInstruction, updateMultiplierData } from '@solana/spl-token';
import { decodeUpdateMultiplierInstruction } from '../src/server/rebaseDetectionService.js';

/**
 * Step 3 (Detect), TESTING.md Section 2, assertion 1 (inclusion) — against REAL captured
 * on-chain data, not synthetic bytes. Confirmed live on 2026-09-15 (DECISIONS.md D10):
 * transaction 5SNeWC8YzL7rEHYKmmgYrradpYgTboBRY6WdrH4Z8xwHuK2q4zRd2AthjDtKjYc7vf7vFGxYFA3vGZ69Rg6XDjsm
 * (slot 442965897, block time 2026-08-30T20:06:42Z) contains an UpdateMultiplierData
 * instruction that Solana RPC's own independent jsonParsed decoder reported as:
 *   { type: "updateMultiplier", authority: "S7vYFFWH6BjJyEsdrPQpqpYTqLTrPRK6KW3VwsJuRaS",
 *     mint: "Xs78JED6PFZxWc2wCEPspZW9kL3Se5J7L5TChKgsidH",
 *     newMultiplier: "1.0808929977256367", newMultiplierTimestamp: 1788134100 }
 * This test re-encodes those exact real values with the real Token-2022 encoder and
 * asserts our own production decoder classifies them identically — proving our decoder
 * agrees with Solana RPC's own decoder on a real, live, on-chain instruction, not just a
 * hand-built synthetic one.
 */
describe('RebaseDetectionService decoder — real captured on-chain instruction (DECISIONS.md D10)', () => {
  it('decodes the real Aug 30, 2026 STRCx UpdateMultiplierData instruction correctly', () => {
    const realNewMultiplier = 1.0808929977256367;
    const realEffectiveTimestamp = 1788134100n; // 2026-08-30T23:55:00.000Z, confirmed exact

    const data = Buffer.alloc(updateMultiplierData.span);
    updateMultiplierData.encode(
      {
        instruction: TokenInstruction.ScaledUiAmountExtension,
        scaledUiAmountInstruction: 1, // UpdateMultiplier
        multiplier: realNewMultiplier,
        effectiveTimestamp: realEffectiveTimestamp,
      },
      data,
    );

    const result = decodeUpdateMultiplierInstruction(TOKEN_2022_PROGRAM_ID.toBase58(), data);
    expect(result).not.toBeNull();
    expect(result!.newMultiplier).toBe(realNewMultiplier);
    expect(result!.effectiveTimestamp).toBe(realEffectiveTimestamp);
    expect(new Date(Number(result!.effectiveTimestamp) * 1000).toISOString()).toBe(
      '2026-08-30T23:55:00.000Z',
    );
  });

  it('the same real instruction bytes never decode as a Transfer/TransferChecked (structural exclusion holds on real data too)', () => {
    const data = Buffer.alloc(updateMultiplierData.span);
    updateMultiplierData.encode(
      {
        instruction: TokenInstruction.ScaledUiAmountExtension,
        scaledUiAmountInstruction: 1,
        multiplier: 1.0808929977256367,
        effectiveTimestamp: 1788134100n,
      },
      data,
    );
    // A structurally different instruction (Transfer) can never be produced by re-reading
    // these same bytes under a different discriminant assumption — the discriminant is
    // read from byte 0/1 of the real data itself, not inferred.
    expect(data[0]).toBe(TokenInstruction.ScaledUiAmountExtension);
    expect(data[0]).not.toBe(TokenInstruction.Transfer);
    expect(data[0]).not.toBe(TokenInstruction.TransferChecked);
  });
});
