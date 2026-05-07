"use client";

import { AnchorProvider } from "@coral-xyz/anchor";
import {
  RescueCipher,
  deserializeLE,
  getMXEPublicKey,
  x25519,
} from "@arcium-hq/client";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";

export type EncryptedBid = {
  ciphertext0: number[];
  ciphertext1: number[];
  pubKey: number[];
  nonce: BN;
  /** Hex-encoded ephemeral private key, kept for forensic reference. */
  privKeyHex: string;
};

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  if (typeof window !== "undefined" && window.crypto) {
    window.crypto.getRandomValues(out);
  } else {
    // Fallback only for SSR — never executed in the bid flow because we gate
    // submission behind `'use client'` + a connected wallet.
    for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  }
  return out;
}

/**
 * Mirror of `getMXEPublicKeyWithRetry` from tests/vickreynftauction.ts.
 * The MXE pubkey is published to the chain after MXE init; if the RPC is slow
 * or the validator just woke up, the read can transiently fail.
 */
export async function getMXEPublicKeyWithRetry(
  provider: AnchorProvider,
  programId: PublicKey,
  maxRetries = 10,
  retryDelayMs = 500
): Promise<Uint8Array> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const key = await getMXEPublicKey(provider, programId);
      if (key) return key;
    } catch (err) {
      lastErr = err;
    }
    if (attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }
  throw new Error(
    `Failed to fetch MXE public key after ${maxRetries} attempts: ${lastErr}`
  );
}

/**
 * Verbatim mirror of the per-bidder encryption flow in tests/vickreynftauction.ts.
 *
 *   1. Random ephemeral x25519 keypair.
 *   2. Shared secret with the MXE pubkey.
 *   3. RescueCipher(sharedSecret).
 *   4. Plaintext = [BigInt(bidLamports), BigInt(active ? 1 : 0)].
 *   5. nonce = randomBytes(16).
 *   6. cipher.encrypt(plaintext, nonce) -> 2 ciphertexts.
 */
export function encryptBid(
  bidLamports: bigint,
  mxePublicKey: Uint8Array,
  active: boolean = true
): EncryptedBid {
  const bidderPriv = x25519.utils.randomSecretKey();
  const bidderPub = x25519.getPublicKey(bidderPriv);
  const sharedSecret = x25519.getSharedSecret(bidderPriv, mxePublicKey);
  const cipher = new RescueCipher(sharedSecret);
  const nonce = randomBytes(16);
  const ciphertext = cipher.encrypt(
    [bidLamports, active ? 1n : 0n],
    nonce
  );

  return {
    ciphertext0: Array.from(ciphertext[0]),
    ciphertext1: Array.from(ciphertext[1]),
    pubKey: Array.from(bidderPub),
    nonce: new BN(deserializeLE(nonce).toString()),
    privKeyHex: Buffer.from(bidderPriv).toString("hex"),
  };
}
