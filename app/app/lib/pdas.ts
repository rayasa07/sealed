import { PublicKey } from "@solana/web3.js";
import {
  AUCTION_SEED,
  BIDDER_SEED,
  NFT_AUTHORITY_SEED,
  PROGRAM_ID,
  SOL_ESCROW_SEED,
} from "./constants";

export function auctionPda(seller: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [AUCTION_SEED, seller.toBuffer(), mint.toBuffer()],
    PROGRAM_ID
  )[0];
}

export function bidderRecordPda(
  auction: PublicKey,
  bidder: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [BIDDER_SEED, auction.toBuffer(), bidder.toBuffer()],
    PROGRAM_ID
  )[0];
}

export function solEscrowPda(auction: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [SOL_ESCROW_SEED, auction.toBuffer()],
    PROGRAM_ID
  )[0];
}

export function nftAuthorityPda(auction: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [NFT_AUTHORITY_SEED, auction.toBuffer()],
    PROGRAM_ID
  )[0];
}

export function metadataPda(mint: PublicKey): PublicKey {
  // Metaplex Token Metadata program ID.
  const METADATA_PROGRAM_ID = new PublicKey(
    "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
  );
  return PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METADATA_PROGRAM_ID
  )[0];
}
