"use client";

import { Connection, PublicKey } from "@solana/web3.js";
import { Metadata } from "@metaplex-foundation/mpl-token-metadata";
import { metadataPda } from "./pdas";

export type NftMetadata = {
  mint: string;
  name: string;
  symbol: string;
  uri: string;
  image: string | null;
  description: string | null;
  collection: string | null;
};

const memoryCache = new Map<string, NftMetadata>();

export function placeholderImage(seed: string): string {
  return `https://picsum.photos/seed/${encodeURIComponent(seed)}/600/600`;
}

function cleanString(s: string): string {
  // Token Metadata pads strings with \0 bytes; strip them.
  return s.replace(/\0/g, "").trim();
}

/**
 * Fetch on-chain Token Metadata for a mint. Falls back to a deterministic
 * picsum placeholder if the metadata account, off-chain JSON, or image URL
 * cannot be loaded — the auction page must always render *something*.
 */
export async function fetchNftMetadata(
  connection: Connection,
  mint: PublicKey
): Promise<NftMetadata> {
  const key = mint.toBase58();
  if (memoryCache.has(key)) return memoryCache.get(key)!;

  const fallback: NftMetadata = {
    mint: key,
    name: `NFT ${key.slice(0, 4)}`,
    symbol: "",
    uri: "",
    image: placeholderImage(key),
    description: null,
    collection: null,
  };

  try {
    const pda = metadataPda(mint);
    const accInfo = await connection.getAccountInfo(pda);
    if (!accInfo) {
      memoryCache.set(key, fallback);
      return fallback;
    }
    const meta = Metadata.deserialize(accInfo.data)[0];
    const onchain: NftMetadata = {
      mint: key,
      name: cleanString(meta.data.name),
      symbol: cleanString(meta.data.symbol),
      uri: cleanString(meta.data.uri),
      image: placeholderImage(key),
      description: null,
      collection: meta.collection?.key?.toBase58() ?? null,
    };

    if (onchain.uri) {
      try {
        const res = await fetch(onchain.uri, { cache: "force-cache" });
        if (res.ok) {
          const json: any = await res.json();
          if (typeof json.image === "string") onchain.image = json.image;
          if (typeof json.description === "string")
            onchain.description = json.description;
          if (typeof json.name === "string" && !onchain.name)
            onchain.name = json.name;
        }
      } catch {
        // off-chain JSON unreachable — keep placeholder image
      }
    }

    memoryCache.set(key, onchain);
    return onchain;
  } catch {
    memoryCache.set(key, fallback);
    return fallback;
  }
}
