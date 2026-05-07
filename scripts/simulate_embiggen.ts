import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  getArciumProgram,
  getArciumProgramId,
} from "@arcium-hq/client";

const PROGRAM_ID = new PublicKey(
  "6K6aykKN8vrBg8RQDtpeJXm6KUo5hG3KFYfyWdi5YS1e"
);
const RPC =
  process.env.RPC_URL ||
  "https://api.devnet.solana.com";

const WALLET_PATH = path.join(
  os.homedir(),
  ".config",
  "solana",
  "arcium-nft.json"
);

function readKeypair(file: string): Keypair {
  const secret = JSON.parse(fs.readFileSync(file, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function getCompDefAccOffsetU32(name: string): number {
  // Hard-coded: derive same as helper. We re-use existing mapping.
  // For our circuit, offset is encoded in compDefPda. We hard-code the offset here.
  // Easier: use getCompDefAccOffset.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getCompDefAccOffset } = require("@arcium-hq/client");
  const buf = getCompDefAccOffset(name) as Uint8Array;
  return Buffer.from(buf).readUInt32LE();
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const owner = readKeypair(WALLET_PATH);
  const wallet = new anchor.Wallet(owner);
  const provider = new anchor.AnchorProvider(conn, wallet, {
    commitment: "confirmed",
  });
  const arciumProgram = getArciumProgram(provider);

  const offset = getCompDefAccOffsetU32("find_winner");
  console.log("comp offset:", offset);
  console.log("payer      :", owner.publicKey.toBase58());
  console.log(
    "balance    :",
    (await conn.getBalance(owner.publicKey)) / anchor.web3.LAMPORTS_PER_SOL,
    "SOL"
  );

  const ix = await arciumProgram.methods
    .embiggenRawCircuitAcc(offset, PROGRAM_ID, 0)
    .accounts({
      signer: owner.publicKey,
    })
    .instruction();

  const tx = new Transaction().add(ix);
  tx.feePayer = owner.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;

  const sim = await conn.simulateTransaction(tx, [owner], true);
  console.log("simulation logs:");
  if (sim.value.logs) for (const l of sim.value.logs) console.log("  ", l);
  console.log("err:", sim.value.err);
  console.log("unitsConsumed:", sim.value.unitsConsumed);
  console.log("returnData:", sim.value.returnData);

  // Now try with 18 embiggen ixs to see if the multi-ix tx works (Solana realloc per-tx limits)
  const tx18 = new Transaction();
  for (let i = 0; i < 18; i++) tx18.add(ix);
  tx18.feePayer = owner.publicKey;
  tx18.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  const sim18 = await conn.simulateTransaction(tx18, [owner], true);
  console.log("\n=== 18-ix simulation ===");
  if (sim18.value.logs) {
    // Print last 10 logs
    const logs = sim18.value.logs;
    for (const l of logs.slice(Math.max(0, logs.length - 30))) console.log("  ", l);
  }
  console.log("err:", sim18.value.err);
  console.log("unitsConsumed:", sim18.value.unitsConsumed);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
