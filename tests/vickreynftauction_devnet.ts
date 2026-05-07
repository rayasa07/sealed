/**
 * End-to-end Vickrey auction test against Solana DEVNET (no localnet, no airdrops).
 *
 * Requirements:
 *   - Deployed program at PROGRAM_ID below.
 *   - find_winner comp def already in OnchainFinalized state on devnet.
 *   - Deploy wallet at ~/.config/solana/arcium-nft.json funded with > ~10 SOL.
 *
 * Run via:
 *   ARCIUM_CLUSTER_OFFSET=456 \
 *     npx ts-mocha -p ./tsconfig.json -t 1200000 tests/vickreynftauction_devnet.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  Connection,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  mintTo,
  getAccount as getTokenAccount,
} from "@solana/spl-token";
import {
  createCreateMetadataAccountV3Instruction,
  PROGRAM_ID as METADATA_PROGRAM_ID,
} from "@metaplex-foundation/mpl-token-metadata";
import { Vickreynftauction } from "../target/types/vickreynftauction";
import { randomBytes } from "crypto";
import {
  awaitComputationFinalization,
  getArciumEnv,
  getCompDefAccOffset,
  getArciumAccountBaseSeed,
  getArciumProgramId,
  getArciumProgram,
  getFeePoolAccAddress,
  getClockAccAddress,
  RescueCipher,
  deserializeLE,
  getMXEPublicKey,
  getMXEAccAddress,
  getMempoolAccAddress,
  getCompDefAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getClusterAccAddress,
  x25519,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { expect } from "chai";

// ============================================================================
//  Devnet config
// ============================================================================
const PROGRAM_ID = new PublicKey(
  "6K6aykKN8vrBg8RQDtpeJXm6KUo5hG3KFYfyWdi5YS1e"
);
const RPC_URL =
  process.env.RPC_URL ||
  "https://devnet.helius-rpc.com/?api-key=YOUR_HELIUS_KEY";
const DEPLOY_WALLET_PATH = path.join(
  os.homedir(),
  ".config",
  "solana",
  "arcium-nft.json"
);
// Hard upper bound on SOL the deploy wallet may shed during this run.
const SOL_BUDGET_LAMPORTS = 10n * BigInt(LAMPORTS_PER_SOL);

// Bid scenario tuned to fit the 10 SOL budget while preserving the
// "winner_index=1, second_price=3 SOL" outcome the constraint requires.
const BID_SCENARIO = {
  bidder0: { bid: 100_000_000n /* 0.1 SOL */, max: 200_000_000n /* 0.2 SOL */ },
  bidder1: { bid: 3_500_000_000n /* 3.5 SOL */, max: 4_000_000_000n /* 4 SOL */ }, // winner
  bidder2: { bid: 3_000_000_000n /* 3 SOL  */, max: 3_500_000_000n /* 3.5 SOL */ },
};
const SECOND_PRICE_LAMPORTS = 3_000_000_000n; // bidder2's bid; what winner pays seller

// Funding amounts (transferred from deploy wallet to each test wallet).
const FUNDING = {
  seller: 0.5 * LAMPORTS_PER_SOL,
  bidder0: 0.3 * LAMPORTS_PER_SOL,
  bidder1: 4.2 * LAMPORTS_PER_SOL,
  bidder2: 3.7 * LAMPORTS_PER_SOL,
  dummy: 0.05 * LAMPORTS_PER_SOL,
};

const AUCTION_SEED = Buffer.from("auction");
const BIDDER_SEED = Buffer.from("bidder");
const SOL_ESCROW_SEED = Buffer.from("sol_escrow");
const NFT_AUTHORITY_SEED = Buffer.from("nft_authority");

// ============================================================================
//  Resilient fetch — wraps global fetch so every web3.js / Anchor RPC call
//  retries on the WSL2 TLS dropouts (BadRecordMac, SocketError, etc.).
// ============================================================================
const RETRYABLE_FETCH_PATTERNS: RegExp[] = [
  /BadRecordMac/i,
  /SocketError/i,
  /fetch failed/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /UND_ERR_/i,
  /socket hang up/i,
  /TLS/i,
  /network/i,
  /503/,
  /502/,
  /504/,
  /429/,
];
function isRetryableFetchError(err: unknown): boolean {
  const m = `${(err as any)?.message ?? ""} ${(err as any)?.cause?.message ?? ""} ${(err as any)?.cause?.code ?? ""} ${err}`;
  return RETRYABLE_FETCH_PATTERNS.some((re) => re.test(m));
}
function installRetryFetch(maxRetries = 5): void {
  const originalFetch = globalThis.fetch.bind(globalThis);
  (globalThis as any).fetch = async (url: any, init?: any) => {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await originalFetch(url, init);
      } catch (err) {
        lastErr = err;
        if (attempt === maxRetries || !isRetryableFetchError(err)) throw err;
        const backoffMs = Math.min(4000, 250 * 2 ** (attempt - 1));
        console.warn(
          `[fetch retry ${attempt}/${maxRetries}] ${(err as any)?.message ?? err} — backoff ${backoffMs}ms`
        );
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
    throw lastErr;
  };
}
installRetryFetch();

async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  maxRetries: number = 5,
  baseDelayMs: number = 500
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = (err as any)?.message ?? String(err);
      const retryable =
        isRetryableFetchError(err) ||
        /Blockhash not found|node is behind|block height exceeded/i.test(msg);
      if (attempt === maxRetries || !retryable) throw err;
      const backoff = Math.min(4000, baseDelayMs * 2 ** (attempt - 1));
      console.warn(
        `[withRetry ${attempt}/${maxRetries}] ${label}: ${msg} — backoff ${backoff}ms`
      );
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}

// ============================================================================
//  Test
// ============================================================================
describe("Vickreynftauction (devnet)", () => {
  // Build provider manually — anchor.AnchorProvider.env() would force us to
  // export ANCHOR_WALLET / ANCHOR_PROVIDER_URL, and we want this test to be
  // self-contained.
  const ownerKp = readKpJson(DEPLOY_WALLET_PATH);
  const connection = new Connection(RPC_URL, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 120_000,
  });
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(ownerKp),
    {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
      skipPreflight: false,
    }
  );
  anchor.setProvider(provider);

  const idl = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "..", "target", "idl", "vickreynftauction.json"),
      "utf8"
    )
  );
  const program = new anchor.Program<Vickreynftauction>(idl, provider);
  const arciumProgram = getArciumProgram(provider);
  const arciumEnv = getArciumEnv();
  const clusterAccount = getClusterAccAddress(arciumEnv.arciumClusterOffset);

  const auctionPda = (seller: PublicKey, mint: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [AUCTION_SEED, seller.toBuffer(), mint.toBuffer()],
      program.programId
    )[0];
  const bidderRecordPda = (auction: PublicKey, bidder: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [BIDDER_SEED, auction.toBuffer(), bidder.toBuffer()],
      program.programId
    )[0];
  const solEscrowPda = (auction: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [SOL_ESCROW_SEED, auction.toBuffer()],
      program.programId
    )[0];
  const nftAuthorityPda = (auction: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [NFT_AUTHORITY_SEED, auction.toBuffer()],
      program.programId
    )[0];

  const seller = Keypair.generate();
  const bidder0 = Keypair.generate();
  const bidder1 = Keypair.generate();
  const bidder2 = Keypair.generate();
  const dummyBidders = Array.from({ length: 5 }, () => Keypair.generate());
  const bidders = [bidder0, bidder1, bidder2, ...dummyBidders];

  let mxePublicKey: Uint8Array;
  let nftMint: PublicKey;
  let auction: PublicKey;
  let nftEscrowAuthority: PublicKey;
  let nftEscrowToken: PublicKey;
  let solEscrow: PublicKey;
  let sellerNftAccount: PublicKey;
  let ownerStartBalance: bigint;

  before("devnet setup: fund test wallets, mint NFT, verify comp def", async function () {
    this.timeout(600_000);

    if (!program.programId.equals(PROGRAM_ID)) {
      throw new Error(
        `Program ID mismatch: IDL=${program.programId.toBase58()} expected=${PROGRAM_ID.toBase58()}`
      );
    }

    console.log("=".repeat(72));
    console.log("DEVNET E2E TEST");
    console.log("=".repeat(72));
    console.log("RPC URL          :", RPC_URL);
    console.log("Program ID       :", program.programId.toBase58());
    console.log("Cluster offset   :", arciumEnv.arciumClusterOffset);
    console.log("Deploy wallet    :", ownerKp.publicKey.toBase58());
    console.log("Seller           :", seller.publicKey.toBase58());
    console.log("Bidder0          :", bidder0.publicKey.toBase58());
    console.log("Bidder1 (winner) :", bidder1.publicKey.toBase58());
    console.log("Bidder2          :", bidder2.publicKey.toBase58());
    console.log("=".repeat(72));

    ownerStartBalance = BigInt(
      await withRetry("getBalance(owner@start)", () =>
        connection.getBalance(ownerKp.publicKey, "confirmed")
      )
    );
    console.log(
      `Deploy wallet starting balance: ${(Number(ownerStartBalance) / LAMPORTS_PER_SOL).toFixed(6)} SOL`
    );
    if (ownerStartBalance < SOL_BUDGET_LAMPORTS) {
      throw new Error(
        `Deploy wallet has only ${Number(ownerStartBalance) / LAMPORTS_PER_SOL} SOL (< 10 SOL budget)`
      );
    }

    // 1. Fund seller + bidders from deploy wallet via SystemProgram.transfer.
    const fundingPlan: Array<{ pubkey: PublicKey; lamports: number; label: string }> = [
      { pubkey: seller.publicKey, lamports: FUNDING.seller, label: "seller" },
      { pubkey: bidder0.publicKey, lamports: FUNDING.bidder0, label: "bidder0" },
      { pubkey: bidder1.publicKey, lamports: FUNDING.bidder1, label: "bidder1" },
      { pubkey: bidder2.publicKey, lamports: FUNDING.bidder2, label: "bidder2" },
      ...dummyBidders.map((kp, i) => ({
        pubkey: kp.publicKey,
        lamports: FUNDING.dummy,
        label: `dummy${i}`,
      })),
    ];
    const totalFunding = fundingPlan.reduce((acc, p) => acc + p.lamports, 0);
    console.log(
      `Funding ${fundingPlan.length} test wallets (total ${(totalFunding / LAMPORTS_PER_SOL).toFixed(4)} SOL)...`
    );
    // Bundle into a few txs; one tx per recipient is simplest and most resilient.
    for (const { pubkey, lamports, label } of fundingPlan) {
      await withRetry(`fund ${label}`, async () => {
        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: ownerKp.publicKey,
            toPubkey: pubkey,
            lamports,
          })
        );
        const sig = await sendAndConfirmTransaction(connection, tx, [ownerKp], {
          commitment: "confirmed",
        });
        console.log(`  ✓ ${label} funded ${(lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL  (${sig.slice(0, 16)}…)`);
      });
      await assertBudgetOk();
    }

    // 2. Fetch MXE x25519 pubkey.
    console.log("Fetching MXE x25519 pubkey...");
    mxePublicKey = await getMXEPublicKeyWithRetry(provider, program.programId);
    console.log("  MXE x25519 pubkey:", Buffer.from(mxePublicKey).toString("hex"));

    // 3. Mint a fresh Metaplex NFT to seller.
    console.log("Minting NFT to seller...");
    const mintKeypair = Keypair.generate();
    nftMint = await createMetaplexNft(connection, seller, mintKeypair);
    console.log("  ✓ NFT minted:", nftMint.toBase58());
    sellerNftAccount = getAssociatedTokenAddressSync(nftMint, seller.publicKey);

    auction = auctionPda(seller.publicKey, nftMint);
    nftEscrowAuthority = nftAuthorityPda(auction);
    nftEscrowToken = getAssociatedTokenAddressSync(nftMint, nftEscrowAuthority, true);
    solEscrow = solEscrowPda(auction);

    // 4. Verify find_winner comp def is already finalized on devnet.
    const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");
    const offset = getCompDefAccOffset("find_winner");
    const compDefPda = PublicKey.findProgramAddressSync(
      [baseSeed, program.programId.toBuffer(), offset],
      getArciumProgramId()
    )[0];
    const existing = await withRetry("getAccountInfo(compDef)", () =>
      connection.getAccountInfo(compDefPda)
    );
    if (existing === null) {
      throw new Error(
        `find_winner comp def at ${compDefPda.toBase58()} does not exist on devnet`
      );
    }
    console.log(`  ✓ find_winner comp def present at ${compDefPda.toBase58()}`);

    await assertBudgetOk();
  });

  it("runs full Vickrey auction E2E on devnet", async function () {
    this.timeout(900_000);

    // 1. create_auction
    const slot = await withRetry("getSlot", () => connection.getSlot("confirmed"));
    const now = await withRetry("getBlockTime", () => connection.getBlockTime(slot));
    if (now === null) throw new Error("Failed to read validator clock");
    const endTs = new anchor.BN(now + 30);
    console.log(`\n[1] Creating auction (now=${now}, end_ts=${endTs.toNumber()})...`);

    const [metadataPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), nftMint.toBuffer()],
      METADATA_PROGRAM_ID
    );

    await withRetry("createAuction", () =>
      program.methods
        .createAuction(endTs)
        .accountsPartial({
          seller: seller.publicKey,
          nftMint,
          nftMetadata: metadataPda,
          sellerNftAccount,
          nftEscrowAuthority,
          nftEscrowTokenAccount: nftEscrowToken,
          auctionConfig: auction,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          metadataProgram: METADATA_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([seller])
        .rpc({ skipPreflight: false, commitment: "confirmed" })
    );

    let auctionAcc = await withRetry("fetch(auction)", () =>
      program.account.auctionConfig.fetch(auction)
    );
    expect(JSON.stringify(auctionAcc.state)).to.equal(
      JSON.stringify({ active: {} })
    );
    expect(auctionAcc.bidCount).to.equal(0);
    const escrowAfterCreate = await withRetry("get(escrowToken)", () =>
      getTokenAccount(connection, nftEscrowToken)
    );
    expect(escrowAfterCreate.amount.toString()).to.equal("1");
    console.log("  ✓ auction created; NFT in escrow");
    await assertBudgetOk();

    // 2. Submit 3 real + 5 dummy bids.
    const bidScenario = [
      { kp: bidder0, ...BID_SCENARIO.bidder0, active: true },
      { kp: bidder1, ...BID_SCENARIO.bidder1, active: true },
      { kp: bidder2, ...BID_SCENARIO.bidder2, active: true },
      ...dummyBidders.map((kp) => ({ kp, bid: 0n, max: 1n, active: false })),
    ];

    console.log(`\n[2] Submitting ${bidScenario.length} bids (3 real + 5 dummies)...`);
    for (let i = 0; i < bidScenario.length; i++) {
      const { kp, bid, max, active } = bidScenario[i];
      const bidderPriv = x25519.utils.randomSecretKey();
      const bidderPub = x25519.getPublicKey(bidderPriv);
      const sharedSecret = x25519.getSharedSecret(bidderPriv, mxePublicKey);
      const cipher = new RescueCipher(sharedSecret);
      const nonce = randomBytes(16);
      const ciphertext = cipher.encrypt([bid, active ? 1n : 0n], nonce);

      const record = bidderRecordPda(auction, kp.publicKey);
      console.log(
        `  bidder${i}: bid=${(Number(bid) / LAMPORTS_PER_SOL).toFixed(4)} SOL  max=${(Number(max) / LAMPORTS_PER_SOL).toFixed(4)} SOL  active=${active}`
      );

      await withRetry(`submitBid[${i}]`, () =>
        program.methods
          .submitBid(
            Array.from(ciphertext[0]),
            Array.from(ciphertext[1]),
            Array.from(bidderPub),
            new anchor.BN(deserializeLE(nonce).toString()),
            new anchor.BN(max.toString())
          )
          .accountsPartial({
            bidder: kp.publicKey,
            auctionConfig: auction,
            bidderRecord: record,
            solEscrow,
            systemProgram: SystemProgram.programId,
          })
          .signers([kp])
          .rpc({ skipPreflight: false, commitment: "confirmed" })
      );
      await assertBudgetOk();
    }

    auctionAcc = await withRetry("fetch(auction)", () =>
      program.account.auctionConfig.fetch(auction)
    );
    expect(auctionAcc.bidCount).to.equal(8);
    const totalCollateral = bidScenario.reduce((acc, b) => acc + b.max, 0n);
    const escrowBal = BigInt(
      await withRetry("getBalance(solEscrow)", () => connection.getBalance(solEscrow))
    );
    expect(escrowBal >= totalCollateral).to.equal(true);
    console.log("  ✓ all 8 bids accepted; escrow holds expected collateral");

    // 3. Wait past end_ts.
    console.log("\n[3] Waiting past end_ts (devnet clock)...");
    while (true) {
      const s = await withRetry("getSlot", () => connection.getSlot("confirmed"));
      const t = await withRetry("getBlockTime", () => connection.getBlockTime(s));
      if (t !== null && t >= endTs.toNumber() + 1) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    console.log("  ✓ end_ts passed");

    // 4. queue_find_winner
    const computationOffset = new anchor.BN(randomBytes(8), "hex");
    console.log(`\n[4] Queueing find_winner (offset=${computationOffset.toString()})...`);
    const remainingAccounts = bidders.map((kp) => ({
      pubkey: bidderRecordPda(auction, kp.publicKey),
      isSigner: false,
      isWritable: false,
    }));

    await withRetry("queueFindWinner", () =>
      program.methods
        .queueFindWinner(computationOffset)
        .accountsPartial({
          payer: seller.publicKey,
          auctionConfig: auction,
          mxeAccount: getMXEAccAddress(program.programId),
          mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
          executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
          computationAccount: getComputationAccAddress(
            arciumEnv.arciumClusterOffset,
            computationOffset
          ),
          compDefAccount: getCompDefAccAddress(
            program.programId,
            Buffer.from(getCompDefAccOffset("find_winner")).readUInt32LE()
          ),
          clusterAccount,
          poolAccount: getFeePoolAccAddress(),
          clockAccount: getClockAccAddress(),
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(remainingAccounts)
        .signers([seller])
        .rpc({ skipPreflight: false, commitment: "confirmed" })
    );
    console.log("  ✓ queued");
    await assertBudgetOk();

    // 5. Await Arcium MPC finalization (devnet may take 1–5 min).
    console.log("\n[5] Awaiting MPC finalization on real Arcium devnet nodes...");
    const finalizeStart = Date.now();
    const finalizeSig = await awaitComputationFinalization(
      provider,
      computationOffset,
      program.programId,
      "confirmed",
      600_000
    );
    const elapsed = ((Date.now() - finalizeStart) / 1000).toFixed(1);
    console.log(`  ✓ Finalized in ${elapsed}s`);
    console.log(`    finalize sig: ${finalizeSig}`);

    // 6. Verify winner state
    auctionAcc = await waitForAuctionWinnerState(
      program,
      connection,
      auction,
      finalizeSig,
      getComputationAccAddress(arciumEnv.arciumClusterOffset, computationOffset),
      60_000
    );
    console.log(
      `[6] winner_index=${auctionAcc.winnerBidderIndex} second_price=${auctionAcc.secondPrice.toString()} has_valid_winner=${auctionAcc.hasValidWinner} state=${JSON.stringify(auctionAcc.state)}`
    );
    expect(auctionAcc.winnerComputed).to.equal(true);
    expect(auctionAcc.hasValidWinner).to.equal(true);
    expect(auctionAcc.winnerBidderIndex).to.equal(1);
    expect(auctionAcc.secondPrice.toString()).to.equal(SECOND_PRICE_LAMPORTS.toString());
    expect(JSON.stringify(auctionAcc.state)).to.equal(
      JSON.stringify({ winnerComputed: {} })
    );
    console.log("  ✓ MPC produced winner_index=1 second_price=3000000000 ✓");

    // 7. settle_auction
    const sellerBalBefore = BigInt(
      await withRetry("getBalance(seller)", () =>
        connection.getBalance(seller.publicKey)
      )
    );
    const winnerBalBefore = BigInt(
      await withRetry("getBalance(bidder1)", () =>
        connection.getBalance(bidder1.publicKey)
      )
    );
    const winnerNftAta = getAssociatedTokenAddressSync(nftMint, bidder1.publicKey);

    console.log("\n[7] Settling auction (caller=bidder1, winner)...");
    await withRetry("settleAuction", () =>
      program.methods
        .settleAuction()
        .accountsPartial({
          caller: bidder1.publicKey,
          auctionConfig: auction,
          winnerRecord: bidderRecordPda(auction, bidder1.publicKey),
          winner: bidder1.publicKey,
          seller: seller.publicKey,
          solEscrow,
          nftEscrowTokenAccount: nftEscrowToken,
          winnerNftAccount: winnerNftAta,
          nftMint,
          nftEscrowAuthority,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([bidder1])
        .rpc({ skipPreflight: false, commitment: "confirmed" })
    );

    auctionAcc = await withRetry("fetch(auction)", () =>
      program.account.auctionConfig.fetch(auction)
    );
    expect(auctionAcc.settled).to.equal(true);
    expect(JSON.stringify(auctionAcc.state)).to.equal(
      JSON.stringify({ settled: {} })
    );

    const winnerRecord = await program.account.bidderRecord.fetch(
      bidderRecordPda(auction, bidder1.publicKey)
    );
    expect(winnerRecord.isWinner).to.equal(true);
    expect(winnerRecord.refunded).to.equal(true);

    const winnerNftBal = await withRetry("get(winnerNft)", () =>
      getTokenAccount(connection, winnerNftAta)
    );
    expect(winnerNftBal.amount.toString()).to.equal("1");
    console.log("  ✓ NFT transferred to winner");

    // Seller delta == second_price (within tx-fee tolerance)
    const sellerBalAfter = BigInt(
      await withRetry("getBalance(seller)", () =>
        connection.getBalance(seller.publicKey)
      )
    );
    const sellerDelta = sellerBalAfter - sellerBalBefore;
    const tolerance = BigInt(0.01 * LAMPORTS_PER_SOL);
    console.log(
      `  seller delta: ${sellerDelta} (expected ~${SECOND_PRICE_LAMPORTS})`
    );
    expect(Number(sellerDelta)).to.be.gte(
      Number(SECOND_PRICE_LAMPORTS - tolerance)
    );
    expect(Number(sellerDelta)).to.be.lte(
      Number(SECOND_PRICE_LAMPORTS + tolerance)
    );

    // Winner net change at settle: +excess (max - second_price = 1 SOL) − tx fee − ATA rent.
    const winnerBalAfter = BigInt(
      await withRetry("getBalance(bidder1)", () =>
        connection.getBalance(bidder1.publicKey)
      )
    );
    const winnerSettleDelta = winnerBalAfter - winnerBalBefore;
    const expectedExcess = BID_SCENARIO.bidder1.max - SECOND_PRICE_LAMPORTS; // 1 SOL
    console.log(
      `  bidder1 settle delta: ${winnerSettleDelta} (expected ~+${expectedExcess} minus fees+rent)`
    );
    expect(Number(winnerSettleDelta)).to.be.greaterThan(Number(expectedExcess - 50_000_000n)); // -0.05 SOL slack
    expect(Number(winnerSettleDelta)).to.be.lessThanOrEqual(Number(expectedExcess));
    await assertBudgetOk();

    // 8. Refund every loser; process largest refund LAST so escrow drains cleanly.
    console.log("\n[8] Refunding losers...");
    const losers = bidScenario
      .map((entry, idx) => ({ ...entry, idx }))
      .filter(({ idx }) => idx !== 1)
      .sort((a, b) => Number(a.max - b.max));

    for (const { idx, kp, max: expectedRefund } of losers) {
      const balBefore = BigInt(
        await withRetry(`getBalance(bidder${idx})`, () =>
          connection.getBalance(kp.publicKey)
        )
      );
      await withRetry(`refundLoser[${idx}]`, () =>
        program.methods
          .refundLoser()
          .accountsPartial({
            caller: kp.publicKey,
            auctionConfig: auction,
            bidderRecord: bidderRecordPda(auction, kp.publicKey),
            bidder: kp.publicKey,
            solEscrow,
            systemProgram: SystemProgram.programId,
          })
          .signers([kp])
          .rpc({ skipPreflight: false, commitment: "confirmed" })
      );
      const balAfter = BigInt(
        await withRetry(`getBalance(bidder${idx})`, () =>
          connection.getBalance(kp.publicKey)
        )
      );
      const delta = balAfter - balBefore;
      console.log(
        `  bidder${idx} refund delta: ${delta} (expected ~${expectedRefund})`
      );
      const txFeeTolerance = BigInt(0.001 * LAMPORTS_PER_SOL);
      expect(Number(delta)).to.be.gte(Number(expectedRefund - txFeeTolerance));
      expect(Number(delta)).to.be.lte(Number(expectedRefund));
      const rec = await program.account.bidderRecord.fetch(
        bidderRecordPda(auction, kp.publicKey)
      );
      expect(rec.refunded).to.equal(true);
      await assertBudgetOk();
    }

    const ownerEnd = BigInt(
      await withRetry("getBalance(owner@end)", () =>
        connection.getBalance(ownerKp.publicKey)
      )
    );
    const consumed = ownerStartBalance - ownerEnd;
    console.log(
      `\nDeploy wallet consumed: ${(Number(consumed) / LAMPORTS_PER_SOL).toFixed(6)} SOL (budget ${Number(SOL_BUDGET_LAMPORTS) / LAMPORTS_PER_SOL} SOL)`
    );
    console.log("\n" + "=".repeat(72));
    console.log("DEVNET E2E TEST PASSED ✓");
    console.log("=".repeat(72));
  });

  // ===== helpers =====

  async function assertBudgetOk(): Promise<void> {
    const cur = BigInt(
      await withRetry("getBalance(owner)", () =>
        connection.getBalance(ownerKp.publicKey, "confirmed")
      )
    );
    const consumed = ownerStartBalance - cur;
    if (consumed > SOL_BUDGET_LAMPORTS) {
      throw new Error(
        `Budget exhausted: deploy wallet consumed ${Number(consumed) / LAMPORTS_PER_SOL} SOL > 10 SOL limit`
      );
    }
  }
});

async function waitForAuctionWinnerState(
  program: Program<Vickreynftauction>,
  connection: Connection,
  auction: PublicKey,
  finalizeSig: string,
  computationAccount: PublicKey,
  timeoutMs: number = 60_000,
  pollIntervalMs: number = 1_000
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const auctionAcc = await withRetry("fetch(auction state)", () =>
      program.account.auctionConfig.fetch(auction)
    );
    const state = JSON.stringify(auctionAcc.state);
    if (state !== JSON.stringify({ computationPending: {} })) return auctionAcc;
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  // Diagnostics on timeout.
  try {
    const tx = await connection.getTransaction(finalizeSig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (tx?.meta?.logMessages) {
      console.error("Finalization tx logs:");
      for (const log of tx.meta.logMessages) console.error(log);
    }
    const compSigs = await connection.getSignaturesForAddress(
      computationAccount,
      { limit: 5 },
      "confirmed"
    );
    console.error(
      "Recent computation signatures:",
      compSigs.map((s) => s.signature)
    );
  } catch (_) { /* ignore */ }

  throw new Error(`Auction callback did not update state within ${timeoutMs}ms`);
}

async function createMetaplexNft(
  connection: Connection,
  payer: Keypair,
  mintKeypair: Keypair
): Promise<PublicKey> {
  const mint = await withRetry("createMint", () =>
    createMint(connection, payer, payer.publicKey, payer.publicKey, 0, mintKeypair)
  );
  const ata = await withRetry("createATA", () =>
    createAssociatedTokenAccount(connection, payer, mint, payer.publicKey)
  );
  await withRetry("mintTo", () =>
    mintTo(connection, payer, mint, ata, payer, 1)
  );
  const [metadataPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METADATA_PROGRAM_ID
  );
  const ix = createCreateMetadataAccountV3Instruction(
    {
      metadata: metadataPda,
      mint,
      mintAuthority: payer.publicKey,
      payer: payer.publicKey,
      updateAuthority: payer.publicKey,
    },
    {
      createMetadataAccountArgsV3: {
        data: {
          name: "DevnetTestNFT",
          symbol: "DTNFT",
          uri: "https://example.com/nft.json",
          sellerFeeBasisPoints: 0,
          creators: null,
          collection: null,
          uses: null,
        },
        isMutable: true,
        collectionDetails: null,
      },
    }
  );
  await withRetry("createMetadata", () =>
    sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer], {
      commitment: "confirmed",
    })
  );
  return mint;
}

async function getMXEPublicKeyWithRetry(
  provider: anchor.AnchorProvider,
  programId: PublicKey,
  maxRetries: number = 30,
  retryDelayMs: number = 500
): Promise<Uint8Array> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const mxePublicKey = await getMXEPublicKey(provider, programId);
      if (mxePublicKey) return mxePublicKey;
    } catch (_) { /* ignore */ }
    if (attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }
  throw new Error(`Failed to fetch MXE public key after ${maxRetries} attempts`);
}

function readKpJson(p: string): Keypair {
  return Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(p, "utf8")))
  );
}
