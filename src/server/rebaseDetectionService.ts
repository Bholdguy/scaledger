import { Connection, PublicKey, VersionedTransactionResponse } from '@solana/web3.js';
import { unpackMint, getScaledUiAmountConfig, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { withRetry } from './rpcRetry.js';
import { getDb } from './db.js';
import { randomUUID } from 'node:crypto';

export interface RebaseEvent {
  id: string;
  mint: string;
  txSignature: string;
  oldMultiplier: number;
  newMultiplier: number;
  effectiveTimestamp: string;
}

/** A decoded UpdateMultiplierData instruction, before old_multiplier is sequenced in. */
export interface RawMultiplierUpdate {
  mint: string;
  txSignature: string;
  newMultiplier: number;
  effectiveTimestamp: string;
  blockTime: number;
}

/**
 * Step 3 (Detect). Reads the mint's ScaledUiAmountConfig extension via getAccountInfo and
 * returns its designated multiplier-update authority — the signer a real
 * `UpdateMultiplierData` instruction on this mint must carry. Mint-level only; no wallet
 * involved. See ARCHITECTURE.md Section 3 step 1, DECISIONS.md D1.
 */
export async function resolveMultiplierAuthority(
  connection: Connection,
  mint: PublicKey,
): Promise<PublicKey> {
  const accountInfo = await withRetry(() => connection.getAccountInfo(mint));
  if (!accountInfo) {
    throw new Error(`mint account not found: ${mint.toBase58()}`);
  }
  const unpacked = unpackMint(mint, accountInfo, TOKEN_2022_PROGRAM_ID);
  const config = getScaledUiAmountConfig(unpacked);
  if (!config) {
    throw new Error(`mint ${mint.toBase58()} has no ScaledUiAmountConfig extension`);
  }
  return new PublicKey(config.authority);
}

/** Also returns the mint's *current* multiplier — needed to sequence old_multiplier values. */
export async function getCurrentMultiplier(connection: Connection, mint: PublicKey): Promise<number> {
  const accountInfo = await withRetry(() => connection.getAccountInfo(mint));
  if (!accountInfo) throw new Error(`mint account not found: ${mint.toBase58()}`);
  const unpacked = unpackMint(mint, accountInfo, TOKEN_2022_PROGRAM_ID);
  const config = getScaledUiAmountConfig(unpacked);
  if (!config) throw new Error(`mint ${mint.toBase58()} has no ScaledUiAmountConfig extension`);
  return config.multiplier;
}

const TOKEN_2022_PROGRAM_ID_STR = TOKEN_2022_PROGRAM_ID.toBase58();

/**
 * Walks the multiplier-update authority's own transaction history (not the mint's — see
 * DECISIONS.md D10) via getSignaturesForAddress, paginated with `before`, bounded to
 * `lookbackDays`. For each signature, fetches the transaction and decodes any Token-2022
 * instruction whose discriminant matches `UpdateMultiplierData` (outer byte 43,
 * sub-instruction 1 — ScaledUiAmountInstruction.UpdateMultiplier) whose accounts include
 * this mint. This is a structural filter on instruction type + target account, never a
 * heuristic over balance changes — see CONTRACT.md / DECISIONS.md D1.
 *
 * Returns raw updates (newest first) without `old_multiplier` — a single instruction only
 * carries the value it sets, not the value it replaced. Use `sequenceOldMultipliers` to
 * turn these into complete `RebaseEvent`s.
 */
export async function findMultiplierUpdates(
  connection: Connection,
  mint: PublicKey,
  authority: PublicKey,
  { lookbackDays = 400 }: { lookbackDays?: number } = {},
): Promise<RawMultiplierUpdate[]> {
  const cutoffSec = Math.floor(Date.now() / 1000) - lookbackDays * 86400;
  const updates: RawMultiplierUpdate[] = [];
  let before: string | undefined;

  outer: while (true) {
    const signatures = await withRetry(() =>
      connection.getSignaturesForAddress(authority, { before, limit: 1000 }),
    );
    if (signatures.length === 0) break;

    for (const sigInfo of signatures) {
      if (sigInfo.blockTime !== null && sigInfo.blockTime !== undefined && sigInfo.blockTime < cutoffSec) {
        break outer;
      }
      if (sigInfo.err) continue;

      const tx = await withRetry(() =>
        connection.getTransaction(sigInfo.signature, {
          maxSupportedTransactionVersion: 0,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (!tx || tx.blockTime === null || tx.blockTime === undefined) continue;

      const update = extractUpdateMultiplierInstruction(tx, sigInfo.signature, mint);
      if (update) updates.push({ ...update, blockTime: tx.blockTime });
    }

    before = signatures[signatures.length - 1].signature;
  }

  return updates;
}

/**
 * Sequences raw updates (any order) into complete RebaseEvents by chaining
 * new_multiplier[i] -> old_multiplier[i+1] in chronological order. `currentMultiplier`
 * anchors the chain: it must equal the newest update's new_multiplier (a sanity check,
 * since it's independently read from the mint's live account state) and gives us nothing
 * to anchor the OLDEST update's old_multiplier — that one is dropped rather than guessed,
 * since PRD.md's invariant is "never assert from one number," and a fabricated
 * old_multiplier for the boundary event would violate that.
 */
export function sequenceOldMultipliers(
  rawUpdates: RawMultiplierUpdate[],
  currentMultiplier: number,
): RebaseEvent[] {
  const chronological = [...rawUpdates].sort((a, b) => a.blockTime - b.blockTime);
  if (chronological.length === 0) return [];

  const newest = chronological[chronological.length - 1];
  if (Math.abs(newest.newMultiplier - currentMultiplier) > 1e-12) {
    throw new Error(
      `sequencing sanity check failed: newest detected update's new_multiplier (${newest.newMultiplier}) ` +
        `does not match the mint's current on-chain multiplier (${currentMultiplier}) — a more recent ` +
        `update may exist outside the scanned window, or the lookback window missed one.`,
    );
  }

  const events: RebaseEvent[] = [];
  for (let i = 1; i < chronological.length; i++) {
    const prev = chronological[i - 1];
    const curr = chronological[i];
    events.push({
      id: randomUUID(),
      mint: curr.mint,
      txSignature: curr.txSignature,
      oldMultiplier: prev.newMultiplier,
      newMultiplier: curr.newMultiplier,
      effectiveTimestamp: curr.effectiveTimestamp,
    });
  }
  return events;
}

/**
 * Structural decoder: classifies a single instruction as `UpdateMultiplierData` or not.
 * Exported separately so the exclusion property (a Transfer/TransferChecked instruction
 * is never classified as UpdateMultiplierData) can be unit-tested directly against the
 * decoder, not just observed as a behavioral side effect. See TESTING.md Section 2,
 * assertion 2(b).
 */
export function decodeUpdateMultiplierInstruction(
  programId: string,
  instructionData: Buffer,
): { newMultiplier: number; effectiveTimestamp: bigint } | null {
  if (programId !== TOKEN_2022_PROGRAM_ID_STR) return null;
  // Token-2022 instruction layout: byte 0 = outer discriminant (43 = ScaledUiAmountExtension),
  // byte 1 = ScaledUiAmountInstruction sub-discriminant (1 = UpdateMultiplier).
  if (instructionData.length < 18) return null;
  const OUTER_DISCRIMINANT_SCALED_UI_AMOUNT = 43;
  const SUB_DISCRIMINANT_UPDATE_MULTIPLIER = 1;
  if (
    instructionData[0] !== OUTER_DISCRIMINANT_SCALED_UI_AMOUNT ||
    instructionData[1] !== SUB_DISCRIMINANT_UPDATE_MULTIPLIER
  ) {
    return null;
  }
  const newMultiplier = instructionData.readDoubleLE(2);
  const effectiveTimestamp = instructionData.readBigInt64LE(10);
  return { newMultiplier, effectiveTimestamp };
}

function extractUpdateMultiplierInstruction(
  tx: VersionedTransactionResponse,
  signature: string,
  mint: PublicKey,
): Omit<RawMultiplierUpdate, 'blockTime'> | null {
  const message = tx.transaction.message;
  const accountKeys = message.getAccountKeys({
    accountKeysFromLookups: tx.meta?.loadedAddresses,
  });

  for (const ix of message.compiledInstructions) {
    const programKey = accountKeys.get(ix.programIdIndex);
    if (!programKey) continue;
    const targetsMint = ix.accountKeyIndexes.some((idx) => accountKeys.get(idx)?.equals(mint));
    if (!targetsMint) continue;

    const decoded = decodeUpdateMultiplierInstruction(programKey.toBase58(), Buffer.from(ix.data));
    if (!decoded) continue;

    return {
      mint: mint.toBase58(),
      txSignature: signature,
      newMultiplier: decoded.newMultiplier,
      effectiveTimestamp: new Date(Number(decoded.effectiveTimestamp) * 1000).toISOString(),
    };
  }
  return null;
}

/** Idempotent on tx_signature (unique constraint) — see ARCHITECTURE.md Section 4. */
export function recordRebaseEvent(event: RebaseEvent): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO RebaseEvents (id, mint, tx_signature, old_multiplier, new_multiplier, effective_timestamp, detected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tx_signature) DO NOTHING`,
  ).run(
    event.id,
    event.mint,
    event.txSignature,
    event.oldMultiplier,
    event.newMultiplier,
    event.effectiveTimestamp,
    new Date().toISOString(),
  );
}
