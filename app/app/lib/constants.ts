import { PublicKey } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID ||
    "6K6aykKN8vrBg8RQDtpeJXm6KUo5hG3KFYfyWdi5YS1e"
);

export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";

export const AUCTION_SEED = Buffer.from("auction");
export const BIDDER_SEED = Buffer.from("bidder");
export const SOL_ESCROW_SEED = Buffer.from("sol_escrow");
export const NFT_AUTHORITY_SEED = Buffer.from("nft_authority");

// Anchor 8-byte discriminator for AuctionConfig (from IDL).
export const AUCTION_CONFIG_DISCRIMINATOR = Buffer.from([
  195, 54, 8, 51, 28, 231, 33, 142,
]);

// Anchor 8-byte discriminator for BidderRecord (from IDL).
export const BIDDER_RECORD_DISCRIMINATOR = Buffer.from([
  76, 44, 50, 157, 218, 244, 61, 115,
]);

// Sum of AuctionConfig fields + 8-byte discriminator. See programs/.../lib.rs.
// 8 (discriminator) + 32+32+32+8+8+1+1+1+8+1+1+1+32+1 = 167.
export const AUCTION_CONFIG_SIZE = 167;

export const MAX_BIDDERS = 8;
