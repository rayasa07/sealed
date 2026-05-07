import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  getArciumAccountBaseSeed,
  getArciumProgram,
  getArciumProgramId,
  getCircuitState,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getLookupTableAddress,
  getMXEAccAddress,
} from "@arcium-hq/client";
import type { Vickreynftauction } from "../target/types/vickreynftauction";

const PROGRAM_ID = new PublicKey(
  "6K6aykKN8vrBg8RQDtpeJXm6KUo5hG3KFYfyWdi5YS1e"
);

const HELIUS_RPC_URL =
  process.env.RPC_URL ||
  "https://devnet.helius-rpc.com/?api-key=YOUR_HELIUS_KEY";
const PUBLIC_RPC_URL = "https://api.devnet.solana.com";

const WALLET_PATH = path.join(
  os.homedir(),
  ".config",
  "solana",
  "arcium-nft.json"
);

const COMMITMENT: anchor.web3.Commitment = "confirmed";
const CONFIRM_OPTS: anchor.web3.ConfirmOptions = {
  commitment: COMMITMENT,
  preflightCommitment: COMMITMENT,
  skipPreflight: true,
};

// These constants mirror @arcium-hq/client v0.9.3 internals.
const RAW_CIRCUIT_INDEX = 0;
const RAW_ACCOUNT_HEADER_BYTES = 9;
const MAX_REALLOC_PER_IX = 10_240;
const MAX_EMBIGGEN_IX_PER_TX = 18;
const MAX_UPLOAD_PER_TX_BYTES = 814;
const DEFAULT_UPLOAD_BATCH_SIZE = Number(
  process.env.UPLOAD_BATCH_SIZE ?? "25"
);
const MAX_SEND_ATTEMPTS = Number(process.env.MAX_SEND_ATTEMPTS ?? "6");
const AIRDROP_CHUNK_SOL = Number(process.env.AIRDROP_CHUNK_SOL ?? "2");
const FEE_BUFFER_SOL = Number(process.env.FEE_BUFFER_SOL ?? "0.2");
const UPLOAD_RESUME_REWIND_BATCHES = Number(
  process.env.UPLOAD_RESUME_REWIND_BATCHES ?? "5"
);
const PROGRESS_FILE = path.join(
  __dirname,
  "..",
  ".cache",
  "find_winner_upload_progress.json"
);

function readKeypair(file: string): Keypair {
  const secret = JSON.parse(fs.readFileSync(file, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function ensureProgressDir(): void {
  fs.mkdirSync(path.dirname(PROGRESS_FILE), { recursive: true });
}

function readUploadProgress(): { completedUploads: number } | null {
  try {
    const raw = fs.readFileSync(PROGRESS_FILE, "utf8");
    const parsed = JSON.parse(raw) as { completedUploads?: number };
    if (typeof parsed.completedUploads === "number") {
      return { completedUploads: parsed.completedUploads };
    }
  } catch {
    // No checkpoint yet.
  }
  return null;
}

function writeUploadProgress(completedUploads: number): void {
  ensureProgressDir();
  fs.writeFileSync(
    PROGRESS_FILE,
    JSON.stringify(
      {
        completedUploads,
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
}

function clearUploadProgress(): void {
  try {
    fs.unlinkSync(PROGRESS_FILE);
  } catch {
    // Ignore missing checkpoint.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

function isRetryableError(err: unknown): boolean {
  const message = describeError(err).toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("429") ||
    message.includes("too many requests") ||
    message.includes("blockhash not found") ||
    message.includes("unknown action") ||
    message.includes("node is behind") ||
    message.includes("connection reset") ||
    message.includes("econnreset") ||
    message.includes("service unavailable")
  );
}

function buildProvider(connection: Connection, owner: Keypair) {
  return new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(owner),
    CONFIRM_OPTS
  );
}

async function sendWithRetry(
  provider: anchor.AnchorProvider,
  label: string,
  buildTx: () => Promise<Transaction>
): Promise<string> {
  let lastErr: unknown;

  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
    try {
      const tx = await buildTx();
      const sig = await provider.sendAndConfirm(tx, [], CONFIRM_OPTS);
      return sig;
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_SEND_ATTEMPTS || !isRetryableError(err)) {
        throw err;
      }

      const backoffMs = 1_000 * attempt;
      console.warn(
        `[retry ${attempt}/${MAX_SEND_ATTEMPTS}] ${label} failed: ${describeError(
          err
        )}`
      );
      console.warn(`Backing off for ${backoffMs}ms...`);
      await sleep(backoffMs);
    }
  }

  throw lastErr ?? new Error(`${label} failed`);
}

async function requestDevnetAirdrops(
  owner: PublicKey,
  requiredLamports: number
): Promise<void> {
  if (requiredLamports <= 0) return;

  const airdropConnection = new Connection(PUBLIC_RPC_URL, COMMITMENT);
  let remaining = requiredLamports;

  console.log(
    `Balance shortfall detected: ${(requiredLamports / LAMPORTS_PER_SOL).toFixed(
      6
    )} SOL`
  );
  console.log("Requesting devnet airdrops to cover rent + fees...");

  while (remaining > 0) {
    const requestLamports = Math.min(
      remaining,
      Math.round(AIRDROP_CHUNK_SOL * LAMPORTS_PER_SOL)
    );

    try {
      const sig = await airdropConnection.requestAirdrop(owner, requestLamports);
      await airdropConnection.confirmTransaction(sig, COMMITMENT);
      remaining -= requestLamports;
      console.log(
        `Airdrop confirmed: ${(requestLamports / LAMPORTS_PER_SOL).toFixed(
          3
        )} SOL (${Math.max(remaining, 0) / LAMPORTS_PER_SOL} SOL remaining)`
      );
      await sleep(1_000);
    } catch (err) {
      console.warn(`Airdrop attempt failed: ${describeError(err)}`);
      console.warn("Waiting 5s before retrying the faucet...");
      await sleep(5_000);
    }
  }
}

async function ensureBalanceForRecovery(
  connection: Connection,
  owner: PublicKey,
  rawCircuitLamports: number,
  requiredAccountSize: number
): Promise<void> {
  const requiredRent = await connection.getMinimumBalanceForRentExemption(
    requiredAccountSize
  );
  const currentBalance = await connection.getBalance(owner, COMMITMENT);
  const feeBufferLamports = Math.round(FEE_BUFFER_SOL * LAMPORTS_PER_SOL);
  const shortfall =
    requiredRent - rawCircuitLamports + feeBufferLamports - currentBalance;

  console.log(
    `Wallet balance: ${(currentBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`
  );
  console.log(
    `Raw circuit rent now: ${(rawCircuitLamports / LAMPORTS_PER_SOL).toFixed(
      6
    )} SOL`
  );
  console.log(
    `Raw circuit rent target: ${(requiredRent / LAMPORTS_PER_SOL).toFixed(
      6
    )} SOL`
  );

  if (shortfall <= 0) {
    console.log("Wallet balance is sufficient for the remaining recovery.");
    return;
  }

  if (process.env.AUTO_AIRDROP !== "1") {
    throw new Error(
      `Insufficient balance to finish upload. Need at least ${(
        shortfall / LAMPORTS_PER_SOL
      ).toFixed(
        6
      )} more SOL. Re-run with AUTO_AIRDROP=1 on devnet to let the script top up from the faucet.`
    );
  }

  await requestDevnetAirdrops(owner, shortfall);
}

async function initCompDefIfMissing(
  provider: anchor.AnchorProvider,
  program: anchor.Program<Vickreynftauction>,
  owner: Keypair,
  compDefPda: PublicKey,
  mxeAccount: PublicKey,
  lutAddress: PublicKey
): Promise<void> {
  const existing = await provider.connection.getAccountInfo(compDefPda);
  if (existing !== null) {
    console.log(
      "comp_def_account already initialized — skipping init_find_winner_comp_def."
    );
    return;
  }

  console.log("Sending init_find_winner_comp_def...");
  const sig = await sendWithRetry(provider, "init_find_winner_comp_def", () =>
    program.methods
      .initFindWinnerCompDef()
      .accounts({
        compDefAccount: compDefPda,
        payer: owner.publicKey,
        mxeAccount,
        addressLookupTable: lutAddress,
      })
      .signers([owner])
      .transaction()
  );

  console.log("✓ comp_def_account initialized");
  console.log("Init tx signature:", sig);
}

async function buildResizeTx(
  provider: anchor.AnchorProvider,
  compDefOffset: number,
  mxeProgramId: PublicKey,
  ixCount: number
): Promise<Transaction> {
  const arciumProgram = getArciumProgram(provider);
  const ix = await arciumProgram.methods
    .embiggenRawCircuitAcc(compDefOffset, mxeProgramId, RAW_CIRCUIT_INDEX)
    .accounts({
      signer: provider.publicKey,
    })
    .instruction();

  const tx = new Transaction();
  for (let i = 0; i < ixCount; i++) {
    tx.add(ix);
  }
  return tx;
}

async function buildUploadTx(
  provider: anchor.AnchorProvider,
  compDefOffset: number,
  mxeProgramId: PublicKey,
  rawCircuit: Buffer,
  circuitOffset: number
): Promise<Transaction> {
  const arciumProgram = getArciumProgram(provider);
  const slice = rawCircuit.subarray(
    circuitOffset,
    circuitOffset + MAX_UPLOAD_PER_TX_BYTES
  );
  const padded = Buffer.alloc(MAX_UPLOAD_PER_TX_BYTES);
  slice.copy(padded);

  return arciumProgram.methods
    .uploadCircuit(
      compDefOffset,
      mxeProgramId,
      RAW_CIRCUIT_INDEX,
      Array.from(padded),
      circuitOffset
    )
    .accounts({
      signer: provider.publicKey,
    })
    .transaction();
}

async function ensureRawCircuitSize(
  provider: anchor.AnchorProvider,
  owner: Keypair,
  compDefPda: PublicKey,
  compDefOffset: number,
  requiredAccountSize: number,
  mxeProgramId: PublicKey
): Promise<PublicKey> {
  const arciumProgram = getArciumProgram(provider);
  const rawCircuitPda = PublicKey.findProgramAddressSync(
    [
      Buffer.from("ComputationDefinitionRaw"),
      compDefPda.toBuffer(),
      Buffer.from([RAW_CIRCUIT_INDEX]),
    ],
    getArciumProgramId()
  )[0];

  let rawInfo = await provider.connection.getAccountInfo(rawCircuitPda);

  if (rawInfo === null) {
    console.log("Initializing raw circuit account...");
    const sig = await sendWithRetry(provider, "init_raw_circuit_acc", () =>
      arciumProgram.methods
        .initRawCircuitAcc(compDefOffset, mxeProgramId, RAW_CIRCUIT_INDEX)
        .accounts({
          signer: owner.publicKey,
        })
        .transaction()
    );
    console.log("Init raw circuit tx:", sig);
    rawInfo = await provider.connection.getAccountInfo(rawCircuitPda);
  }

  if (rawInfo === null) {
    throw new Error("Raw circuit account is still missing after init.");
  }

  console.log("raw_circuit_account:", rawCircuitPda.toBase58());
  console.log(
    `Current raw circuit size: ${rawInfo.data.length} bytes (${(
      rawInfo.lamports / LAMPORTS_PER_SOL
    ).toFixed(6)} SOL rent)`
  );

  await ensureBalanceForRecovery(
    provider.connection,
    owner.publicKey,
    rawInfo.lamports,
    requiredAccountSize
  );

  while (rawInfo.data.length < requiredAccountSize) {
    const remainingBytes = requiredAccountSize - rawInfo.data.length;
    const growBytes = Math.min(
      remainingBytes,
      MAX_REALLOC_PER_IX * MAX_EMBIGGEN_IX_PER_TX
    );
    const ixCount = Math.ceil(growBytes / MAX_REALLOC_PER_IX);

    console.log(
      `Resizing raw circuit account by ${growBytes} bytes using ${ixCount} embiggen instructions...`
    );

    const sig = await sendWithRetry(provider, "embiggen_raw_circuit_acc", () =>
      buildResizeTx(provider, compDefOffset, mxeProgramId, ixCount)
    );

    rawInfo = await provider.connection.getAccountInfo(rawCircuitPda);
    if (rawInfo === null) {
      throw new Error("Raw circuit account disappeared during resize.");
    }

    console.log(
      `Resize tx: ${sig} -> new size ${rawInfo.data.length}/${requiredAccountSize} bytes`
    );
  }

  return rawCircuitPda;
}

async function uploadCircuitWithRetries(
  provider: anchor.AnchorProvider,
  rawCircuit: Buffer,
  compDefOffset: number,
  mxeProgramId: PublicKey
): Promise<string[]> {
  const totalUploads = Math.ceil(rawCircuit.length / MAX_UPLOAD_PER_TX_BYTES);
  const sigs: string[] = [];
  const savedProgress = readUploadProgress();
  const startUploadIndex = Math.max(
    0,
    (savedProgress?.completedUploads ?? 0) - UPLOAD_RESUME_REWIND_BATCHES
  );

  console.log(
    `Uploading ${rawCircuit.length} bytes across ${totalUploads} transactions (batch size ${DEFAULT_UPLOAD_BATCH_SIZE})...`
  );
  if (startUploadIndex > 0) {
    console.log(
      `Resuming from upload ${startUploadIndex + 1}/${totalUploads} using checkpoint ${savedProgress?.completedUploads}.`
    );
  }

  for (
    let uploadIndex = startUploadIndex;
    uploadIndex < totalUploads;
    uploadIndex += DEFAULT_UPLOAD_BATCH_SIZE
  ) {
    const batchCount = Math.min(
      DEFAULT_UPLOAD_BATCH_SIZE,
      totalUploads - uploadIndex
    );
    const batchNumber =
      Math.floor(uploadIndex / DEFAULT_UPLOAD_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(totalUploads / DEFAULT_UPLOAD_BATCH_SIZE);

    console.log(`Sending upload batch ${batchNumber}/${totalBatches}...`);

    const batchResults = await Promise.all(
      Array.from({ length: batchCount }, async (_, batchOffset) => {
        const currentIndex = uploadIndex + batchOffset;
        const circuitOffset = currentIndex * MAX_UPLOAD_PER_TX_BYTES;

        return sendWithRetry(
          provider,
          `upload chunk @ offset ${circuitOffset}`,
          () =>
            buildUploadTx(
              provider,
              compDefOffset,
              mxeProgramId,
              rawCircuit,
              circuitOffset
            )
        );
      })
    );

    sigs.push(...batchResults);
    writeUploadProgress(uploadIndex + batchCount);

    if (batchNumber % 10 === 0 || batchNumber === totalBatches) {
      const uploadedBytes = Math.min(
        rawCircuit.length,
        (uploadIndex + batchCount) * MAX_UPLOAD_PER_TX_BYTES
      );
      console.log(
        `Uploaded ${uploadedBytes}/${rawCircuit.length} bytes (${(
          (uploadedBytes / rawCircuit.length) *
          100
        ).toFixed(2)}%)`
      );
    }
  }

  return sigs;
}

async function finalizeCompDef(
  provider: anchor.AnchorProvider,
  compDefOffset: number,
  mxeProgramId: PublicKey
): Promise<string> {
  const arciumProgram = getArciumProgram(provider);
  console.log("Finalizing computation definition...");
  return sendWithRetry(provider, "finalize_computation_definition", () =>
    arciumProgram.methods
      .finalizeComputationDefinition(compDefOffset, mxeProgramId)
      .accounts({
        signer: provider.publicKey,
      })
      .transaction()
  );
}

async function tryRecoveryOnRpc(
  rpcUrl: string,
  owner: Keypair,
  rawCircuit: Buffer
): Promise<void> {
  console.log(`\n=== Using RPC ${rpcUrl} ===`);

  const connection = new Connection(rpcUrl, COMMITMENT);
  const provider = buildProvider(connection, owner);
  anchor.setProvider(provider);

  const idlPath = path.join(
    __dirname,
    "..",
    "target",
    "idl",
    "vickreynftauction.json"
  );
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  const program = new anchor.Program<Vickreynftauction>(idl, provider);

  if (!program.programId.equals(PROGRAM_ID)) {
    throw new Error(
      `IDL program id ${program.programId.toBase58()} does not match expected ${PROGRAM_ID.toBase58()}`
    );
  }

  const arciumProgram = getArciumProgram(provider);
  const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");
  const offsetBytes = getCompDefAccOffset("find_winner");
  const compDefOffset = Buffer.from(offsetBytes).readUInt32LE(0);
  const compDefPda = PublicKey.findProgramAddressSync(
    [baseSeed, program.programId.toBuffer(), offsetBytes],
    getArciumProgramId()
  )[0];

  const compDefAccountFromHelper = getCompDefAccAddress(
    program.programId,
    compDefOffset
  );
  if (!compDefPda.equals(compDefAccountFromHelper)) {
    throw new Error(
      `comp_def PDA mismatch: ${compDefPda.toBase58()} vs ${compDefAccountFromHelper.toBase58()}`
    );
  }

  console.log("Payer:", owner.publicKey.toBase58());
  console.log("Program ID:", program.programId.toBase58());
  console.log("comp_def_account:", compDefPda.toBase58());

  const mxeAccount = getMXEAccAddress(program.programId);
  const mxeAcc = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
  const lutAddress = getLookupTableAddress(
    program.programId,
    mxeAcc.lutOffsetSlot
  );

  console.log("mxe_account:", mxeAccount.toBase58());
  console.log("address_lookup_table:", lutAddress.toBase58());

  await initCompDefIfMissing(
    provider,
    program,
    owner,
    compDefPda,
    mxeAccount,
    lutAddress
  );

  let compDefAcc =
    await arciumProgram.account.computationDefinitionAccount.fetch(compDefPda);
  let circuitState = getCircuitState(compDefAcc.circuitSource as any);
  console.log("Circuit state before recovery:", circuitState);

  if (circuitState === "OnchainFinalized") {
    console.log("Circuit already uploaded — nothing to do.");
    return;
  }

  const requiredAccountSize = rawCircuit.length + RAW_ACCOUNT_HEADER_BYTES;
  await ensureRawCircuitSize(
    provider,
    owner,
    compDefPda,
    compDefOffset,
    requiredAccountSize,
    program.programId
  );

  const uploadSigs = await uploadCircuitWithRetries(
    provider,
    rawCircuit,
    compDefOffset,
    program.programId
  );
  const finalizeSig = await finalizeCompDef(
    provider,
    compDefOffset,
    program.programId
  );
  clearUploadProgress();

  compDefAcc =
    await arciumProgram.account.computationDefinitionAccount.fetch(compDefPda);
  circuitState = getCircuitState(compDefAcc.circuitSource as any);
  console.log(`Final circuit state: ${circuitState}`);
  console.log(`Upload tx count: ${uploadSigs.length}`);
  console.log(`Finalize tx: ${finalizeSig}`);

  if (circuitState !== "OnchainFinalized") {
    throw new Error(`Expected OnchainFinalized, got ${circuitState}`);
  }
}

async function main() {
  const owner = readKeypair(WALLET_PATH);
  const circuitPath = path.join(
    __dirname,
    "..",
    "build",
    "find_winner.arcis"
  );

  if (!fs.existsSync(circuitPath)) {
    throw new Error(`Circuit file not found at ${circuitPath}`);
  }

  const rawCircuit = fs.readFileSync(circuitPath);
  const rpcUrls = unique([
    process.env.RPC_URL || "",
    PUBLIC_RPC_URL,
    HELIUS_RPC_URL,
  ]);

  console.log("RPC candidates:", rpcUrls.join(", "));
  console.log(`Circuit size: ${rawCircuit.length} bytes`);

  let lastErr: unknown;
  for (const rpcUrl of rpcUrls) {
    try {
      await tryRecoveryOnRpc(rpcUrl, owner, rawCircuit);
      return;
    } catch (err) {
      lastErr = err;
      console.error(`Recovery attempt failed on ${rpcUrl}: ${describeError(err)}`);
    }
  }

  throw lastErr ?? new Error("Recovery failed on all RPC URLs");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
