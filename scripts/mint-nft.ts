import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createInitializeMintInstruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddress,
  getMinimumBalanceForRentExemptMint,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  createCreateMetadataAccountV3Instruction,
  createCreateMasterEditionV3Instruction,
  PROGRAM_ID as TOKEN_METADATA_PROGRAM_ID,
} from "@metaplex-foundation/mpl-token-metadata";

const DESTINATION = new PublicKey(
  "35WMkmBja1EfkQ2EGqNhAzrGz4gruhs5f2pJUNxd9j5o"
);

const ADJECTIVES = [
  "Cosmic", "Neon", "Phantom", "Savage", "Cursed",
  "Golden", "Feral", "Void", "Ancient", "Crystal",
];
const NOUNS = [
  "Dragon", "Ape", "Wizard", "Skull", "Phoenix",
  "Wolf", "Samurai", "Specter", "Titan", "Golem",
];

function randomName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(Math.random() * 9999) + 1;
  return `${adj} ${noun} #${num}`;
}

function metadataPDA(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  )[0];
}

function masterEditionPDA(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
      Buffer.from("edition"),
    ],
    TOKEN_METADATA_PROGRAM_ID
  )[0];
}

async function main() {
  const rpcUrl =
    process.env.RPC_URL ||
    "https://devnet.helius-rpc.com/?api-key=YOUR_HELIUS_KEY";
  const connection = new Connection(rpcUrl, "confirmed");

  const keypairPath = path.join(
    os.homedir(),
    ".config",
    "solana",
    "arcium-nft.json"
  );
  const secret = JSON.parse(fs.readFileSync(keypairPath, "utf8"));
  const payer = Keypair.fromSecretKey(Uint8Array.from(secret));
  const mint = Keypair.generate();

  console.log("Payer:", payer.publicKey.toBase58());
  console.log("Mint:", mint.publicKey.toBase58());

  const nftName = randomName();
  console.log(`\nMinting NFT: "${nftName}"`);

  const lamports = await getMinimumBalanceForRentExemptMint(connection);
  const ata = await getAssociatedTokenAddress(mint.publicKey, DESTINATION);
  const metadataAccount = metadataPDA(mint.publicKey);
  const masterEditionAccount = masterEditionPDA(mint.publicKey);

  const tx = new Transaction().add(
    // Create the mint account
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint.publicKey,
      space: MINT_SIZE,
      lamports,
      programId: TOKEN_PROGRAM_ID,
    }),
    // Initialize as mint with 0 decimals (NFT)
    createInitializeMintInstruction(
      mint.publicKey,
      0,
      payer.publicKey,
      payer.publicKey
    ),
    // Create ATA for destination wallet
    createAssociatedTokenAccountInstruction(
      payer.publicKey,
      ata,
      DESTINATION,
      mint.publicKey
    ),
    // Mint exactly 1 token
    createMintToInstruction(mint.publicKey, ata, payer.publicKey, 1),
    // Create metadata account
    createCreateMetadataAccountV3Instruction(
      {
        metadata: metadataAccount,
        mint: mint.publicKey,
        mintAuthority: payer.publicKey,
        payer: payer.publicKey,
        updateAuthority: payer.publicKey,
      },
      {
        createMetadataAccountArgsV3: {
          data: {
            name: nftName,
            symbol: "RNFT",
            uri: "https://arweave.net/placeholder",
            sellerFeeBasisPoints: 500,
            creators: [
              {
                address: payer.publicKey,
                verified: true,
                share: 100,
              },
            ],
            collection: null,
            uses: null,
          },
          isMutable: true,
          collectionDetails: null,
        },
      }
    ),
    // Create master edition (marks supply=1, NFT is unique)
    createCreateMasterEditionV3Instruction(
      {
        edition: masterEditionAccount,
        mint: mint.publicKey,
        updateAuthority: payer.publicKey,
        mintAuthority: payer.publicKey,
        payer: payer.publicKey,
        metadata: metadataAccount,
      },
      {
        createMasterEditionArgs: {
          maxSupply: 0,
        },
      }
    ),
  );

  console.log("\nSending transaction...");
  const txSig = await sendAndConfirmTransaction(connection, tx, [payer, mint], {
    commitment: "confirmed",
  });

  console.log("\n✓ NFT minted and sent successfully");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("NFT Name    :", nftName);
  console.log("Mint Pubkey :", mint.publicKey.toBase58());
  console.log("Destination :", DESTINATION.toBase58());
  console.log("Tx Signature:", txSig);
  console.log("Explorer    :", `https://explorer.solana.com/tx/${txSig}?cluster=devnet`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
