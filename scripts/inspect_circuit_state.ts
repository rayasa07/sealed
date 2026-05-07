import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  getArciumProgram,
  getArciumProgramId,
  getCircuitState,
  getRawCircuitAccAddress,
} from "@arcium-hq/client";

const COMP_DEF = new PublicKey("EumEzPVoJwdWvM9f2Pmm568SFPGsRBQtNNmTU9SXK4hi");

const RPC =
  process.env.RPC_URL ||
  "https://devnet.helius-rpc.com/?api-key=YOUR_HELIUS_KEY";

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

async function main() {
  const conn = new Connection(RPC, "confirmed");
  console.log("RPC:", RPC);
  console.log("Arcium program:", getArciumProgramId().toBase58());
  console.log("Comp def      :", COMP_DEF.toBase58());

  const owner = readKeypair(WALLET_PATH);
  const wallet = new anchor.Wallet(owner);
  const provider = new anchor.AnchorProvider(conn, wallet, {
    commitment: "confirmed",
  });
  const arciumProgram = getArciumProgram(provider);

  const compDefInfo = await conn.getAccountInfo(COMP_DEF);
  if (!compDefInfo) {
    console.log("comp_def_account: NOT FOUND");
    return;
  }
  console.log(
    "comp_def_account: size",
    compDefInfo.data.length,
    "owner",
    compDefInfo.owner.toBase58()
  );

  const compDefAcc =
    await arciumProgram.account.computationDefinitionAccount.fetch(COMP_DEF);
  console.log(
    "circuit state    :",
    getCircuitState(compDefAcc.circuitSource as any)
  );
  console.log(
    "circuit source   :",
    JSON.stringify(compDefAcc.circuitSource, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
      2
    )
  );

  for (let i = 0; i < 4; i++) {
    const pda = getRawCircuitAccAddress(COMP_DEF, i);
    const info = await conn.getAccountInfo(pda);
    if (!info) {
      console.log(`raw_circuit[${i}]:`, pda.toBase58(), "NOT FOUND");
    } else {
      console.log(
        `raw_circuit[${i}]:`,
        pda.toBase58(),
        "size",
        info.data.length,
        "owner",
        info.owner.toBase58(),
        "lamports",
        info.lamports
      );
    }
  }

  const balance = await conn.getBalance(owner.publicKey);
  console.log(
    "wallet balance   :",
    balance / anchor.web3.LAMPORTS_PER_SOL,
    "SOL"
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
