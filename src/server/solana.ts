import { Connection, PublicKey } from '@solana/web3.js';

let connection: Connection | null = null;

export function getConnection(): Connection {
  if (connection) return connection;
  const url = process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';
  connection = new Connection(url, 'confirmed');
  return connection;
}

/** Validates a Solana base58 public key at the system boundary. See SECURITY.md Section 5. */
export function parsePublicKeyStrict(value: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new InvalidPublicKeyError(value);
  }
}

export class InvalidPublicKeyError extends Error {
  constructor(value: string) {
    super(`not a well-formed Solana base58 public key: ${value}`);
    this.name = 'InvalidPublicKeyError';
  }
}
