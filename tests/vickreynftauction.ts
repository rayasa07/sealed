import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
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
  uploadCircuit,
  RescueCipher,
  deserializeLE,
  getMXEPublicKey,
  getMXEAccAddress,
  getMempoolAccAddress,
  getCompDefAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getClusterAccAddress,
  getLookupTableAddress,
  x25519,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import { expect } from "chai";

const AUCTION_SEED = Buffer.from("auction");
const BIDDER_SEED = Buffer.from("bidder");
const SOL_ESCROW_SEED = Buffer.from("sol_escrow");
const NFT_AUTHORITY_SEED = Buffer.from("nft_authority");

describe("Vickreynftauction", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace
    .Vickreynftauction as Program<Vickreynftauction>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;
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

  const owner = readKpJson(`${os.homedir()}/.config/solana/id.json`);
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

  before("setup: airdrops, NFT mint, comp def init", async function () {
    this.timeout(300_000);

    // 1. Airdrop SOL to seller and all bidders.
    for (const kp of [seller, ...bidders]) {
      const sig = await provider.connection.requestAirdrop(
        kp.publicKey,
        100 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig, "confirmed");
    }

    // 2. Fetch the MXE x25519 pubkey.
    mxePublicKey = await getMXEPublicKeyWithRetry(provider, program.programId);
    console.log("MXE x25519 pubkey:", Buffer.from(mxePublicKey).toString("hex"));

    // 3. Mint a Metaplex classic NFT to the seller.
    const mintKeypair = Keypair.generate();
    nftMint = await createMetaplexNft(
      provider.connection,
      seller,
      mintKeypair
    );
    console.log("NFT mint:", nftMint.toBase58());
    sellerNftAccount = getAssociatedTokenAddressSync(nftMint, seller.publicKey);

    // Pre-derive PDAs that depend on (seller, nftMint).
    auction = auctionPda(seller.publicKey, nftMint);
    nftEscrowAuthority = nftAuthorityPda(auction);
    nftEscrowToken = getAssociatedTokenAddressSync(
      nftMint,
      nftEscrowAuthority,
      true
    );
    solEscrow = solEscrowPda(auction);

    // 4. Initialize the find_winner computation definition.
    console.log("Initializing find_winner comp def...");
    await initFindWinnerCompDef();
  });

  it("runs full Vickrey auction E2E: 3 bidders, settles to second-highest price", async function () {
    this.timeout(600_000);

    // 1. create_auction (seller escrows the NFT, sets end_ts = now + 30s).
    const slot = await provider.connection.getSlot("confirmed");
    const now = await provider.connection.getBlockTime(slot);
    if (now === null) throw new Error("Failed to read validator clock");
    const endTs = new anchor.BN(now + 30);
    console.log(
      `Creating auction (now=${now}, end_ts=${endTs.toNumber()})...`
    );

    const [metadataPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), nftMint.toBuffer()],
      METADATA_PROGRAM_ID
    );

    await program.methods
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
      .rpc({ skipPreflight: false, commitment: "confirmed" });

    let auctionAcc = await program.account.auctionConfig.fetch(auction);
    expect(JSON.stringify(auctionAcc.state)).to.equal(
      JSON.stringify({ active: {} })
    );
    expect(auctionAcc.bidCount).to.equal(0);

    // Sanity: NFT is in escrow.
    const escrowAfterCreate = await getTokenAccount(
      provider.connection,
      nftEscrowToken
    );
    expect(escrowAfterCreate.amount.toString()).to.equal("1");

    // 2. Three live bidders submit Vickrey bids, plus five inactive dummies to fill the fixed-size circuit input.
    const bidScenario = [
      {
        kp: bidder0,
        bid: 1n * BigInt(LAMPORTS_PER_SOL),
        max: 2n * BigInt(LAMPORTS_PER_SOL),
        active: true,
      },
      {
        kp: bidder1,
        bid: 5n * BigInt(LAMPORTS_PER_SOL),
        max: 6n * BigInt(LAMPORTS_PER_SOL),
        active: true,
      },
      {
        kp: bidder2,
        bid: 3n * BigInt(LAMPORTS_PER_SOL),
        max: 4n * BigInt(LAMPORTS_PER_SOL),
        active: true,
      },
      ...dummyBidders.map((kp) => ({
        kp,
        bid: 0n,
        max: 1n,
        active: false,
      })),
    ];

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
        `Bidder ${i}: bid=${bid} max_collateral=${max} -> record ${record.toBase58()}`
      );

      await program.methods
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
        .rpc({ skipPreflight: false, commitment: "confirmed" });
    }

    auctionAcc = await program.account.auctionConfig.fetch(auction);
    expect(auctionAcc.bidCount).to.equal(8);

    // sol_escrow should hold sum of max_collaterals.
    const totalCollateral = bidScenario.reduce((acc, b) => acc + b.max, 0n);
    const escrowBal = BigInt(await provider.connection.getBalance(solEscrow));
    expect(escrowBal >= totalCollateral).to.equal(true);

    // 3. Wait past auction end_ts.
    console.log("Waiting for auction end_ts...");
    while (true) {
      const s = await provider.connection.getSlot("confirmed");
      const t = await provider.connection.getBlockTime(s);
      if (t !== null && t >= endTs.toNumber() + 1) break;
      await new Promise((r) => setTimeout(r, 2000));
    }

    // 4. queue_find_winner with all 3 bidder records as remaining accounts.
    const computationOffset = new anchor.BN(randomBytes(8), "hex");
    console.log(`Queuing find_winner (offset=${computationOffset.toString()})...`);

    const remainingAccounts = bidders.map((kp) => ({
      pubkey: bidderRecordPda(auction, kp.publicKey),
      isSigner: false,
      isWritable: false,
    }));

    await program.methods
      .queueFindWinner(computationOffset)
      .accountsPartial({
        payer: seller.publicKey,
        auctionConfig: auction,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
        executingPool: getExecutingPoolAccAddress(
          arciumEnv.arciumClusterOffset
        ),
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
      .rpc({ skipPreflight: false, commitment: "confirmed" });

    // 5. Await Arcium MPC finalization (callback runs find_winner_callback).
    console.log("Awaiting MPC finalization...");
    const finalizeSig = await awaitComputationFinalization(
      provider,
      computationOffset,
      program.programId,
      "confirmed"
    );
    console.log("Finalized:", finalizeSig);

    // 6. Verify winner state.
    auctionAcc = await waitForAuctionWinnerState(
      program,
      provider.connection,
      auction,
      finalizeSig,
      getComputationAccAddress(
        arciumEnv.arciumClusterOffset,
        computationOffset
      )
    );
    console.log(
      `winner_index=${auctionAcc.winnerBidderIndex} second_price=${auctionAcc.secondPrice.toString()} has_valid_winner=${auctionAcc.hasValidWinner} state=${JSON.stringify(auctionAcc.state)}`
    );
    expect(auctionAcc.winnerComputed).to.equal(true);
    expect(auctionAcc.hasValidWinner).to.equal(true);
    expect(auctionAcc.winnerBidderIndex).to.equal(1);
    expect(auctionAcc.secondPrice.toString()).to.equal(
      (3n * BigInt(LAMPORTS_PER_SOL)).toString()
    );
    expect(JSON.stringify(auctionAcc.state)).to.equal(
      JSON.stringify({ winnerComputed: {} })
    );

    // 7. settle_auction (caller = bidder1 the winner; receives NFT + excess refund).
    const sellerBalBefore = BigInt(
      await provider.connection.getBalance(seller.publicKey)
    );
    const winnerBalBefore = BigInt(
      await provider.connection.getBalance(bidder1.publicKey)
    );
    const winnerNftAta = getAssociatedTokenAddressSync(
      nftMint,
      bidder1.publicKey
    );

    console.log("Settling auction...");
    await program.methods
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
      .rpc({ skipPreflight: false, commitment: "confirmed" });

    // 8. Verify settlement outcomes.
    auctionAcc = await program.account.auctionConfig.fetch(auction);
    expect(auctionAcc.settled).to.equal(true);
    expect(JSON.stringify(auctionAcc.state)).to.equal(
      JSON.stringify({ settled: {} })
    );

    const winnerRecord = await program.account.bidderRecord.fetch(
      bidderRecordPda(auction, bidder1.publicKey)
    );
    expect(winnerRecord.isWinner).to.equal(true);
    expect(winnerRecord.refunded).to.equal(true);

    // Bidder1 received the NFT.
    const winnerNftBal = await getTokenAccount(provider.connection, winnerNftAta);
    expect(winnerNftBal.amount.toString()).to.equal("1");

    // Seller received second_price (3 SOL). Allow small variance for prior tx fees.
    const sellerBalAfter = BigInt(
      await provider.connection.getBalance(seller.publicKey)
    );
    const sellerDelta = sellerBalAfter - sellerBalBefore;
    const expectedSellerDelta = 3n * BigInt(LAMPORTS_PER_SOL);
    const tolerance = BigInt(0.01 * LAMPORTS_PER_SOL); // 0.01 SOL tolerance
    console.log(
      `Seller delta: ${sellerDelta} (expected ~${expectedSellerDelta})`
    );
    expect(Number(sellerDelta)).to.be.gte(
      Number(expectedSellerDelta - tolerance)
    );
    expect(Number(sellerDelta)).to.be.lte(
      Number(expectedSellerDelta + tolerance)
    );

    // Bidder1 net change: paid 6 SOL collateral, got 3 SOL excess back, paid tx fees + ATA rent.
    // Net delta from settle alone: +3 SOL excess refund - tx fees - ATA rent.
    // (Earlier the 6 SOL was already debited at submit_bid time.)
    const winnerBalAfter = BigInt(
      await provider.connection.getBalance(bidder1.publicKey)
    );
    const winnerSettleDelta = winnerBalAfter - winnerBalBefore;
    console.log(
      `Bidder1 settle delta: ${winnerSettleDelta} (expected ~+3 SOL minus fees+rent)`
    );
    // Should be positive (~3 SOL refund) minus the new ATA rent (~0.002 SOL) and tx fee.
    expect(Number(winnerSettleDelta)).to.be.gt(2 * LAMPORTS_PER_SOL);
    expect(Number(winnerSettleDelta)).to.be.lt(3 * LAMPORTS_PER_SOL);

    // 9. Refund every losing bidder. Process the largest refund last so the
    // escrow PDA drains to zero instead of being left below rent-exempt.
    const losers = bidScenario
      .map((entry, idx) => ({ ...entry, idx }))
      .filter(({ idx }) => idx !== 1)
      .sort((a, b) => Number(a.max - b.max));

    for (const { idx, kp, max: expectedRefund } of losers) {
      const balBefore = BigInt(
        await provider.connection.getBalance(kp.publicKey)
      );
      console.log(`refund_loser: bidder${idx}`);
      await program.methods
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
        .rpc({ skipPreflight: false, commitment: "confirmed" });

      const balAfter = BigInt(
        await provider.connection.getBalance(kp.publicKey)
      );
      const delta = balAfter - balBefore;
      console.log(
        `Bidder${idx} refund delta: ${delta} (expected ~${expectedRefund})`
      );
      // Refund minus tx fee.
      const txFeeTolerance = BigInt(0.001 * LAMPORTS_PER_SOL);
      expect(Number(delta)).to.be.gte(Number(expectedRefund - txFeeTolerance));
      expect(Number(delta)).to.be.lte(Number(expectedRefund));

      const rec = await program.account.bidderRecord.fetch(
        bidderRecordPda(auction, kp.publicKey)
      );
      expect(rec.refunded).to.equal(true);
    }
  });

  // ===== helpers =====

  async function initFindWinnerCompDef(): Promise<void> {
    const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");
    const offset = getCompDefAccOffset("find_winner");
    const compDefPda = PublicKey.findProgramAddressSync(
      [baseSeed, program.programId.toBuffer(), offset],
      getArciumProgramId()
    )[0];

    // Idempotent: if comp def already exists from a prior test run, skip.
    const existing = await provider.connection.getAccountInfo(compDefPda);
    if (existing !== null) {
      console.log("find_winner comp def already exists, skipping init.");
      return;
    }

    const mxeAccount = getMXEAccAddress(program.programId);
    const mxeAcc = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
    const lutAddress = getLookupTableAddress(
      program.programId,
      mxeAcc.lutOffsetSlot
    );

    await withBlockhashRetry("initFindWinnerCompDef", async () => {
      await program.methods
        .initFindWinnerCompDef()
        .accounts({
          compDefAccount: compDefPda,
          payer: owner.publicKey,
          mxeAccount,
          addressLookupTable: lutAddress,
        })
        .signers([owner])
        .rpc({ commitment: "confirmed" });
    });

    const rawCircuit = fs.readFileSync("build/find_winner.arcis");
    await withBlockhashRetry("uploadCircuit(find_winner)", async () => {
      await uploadCircuit(
        provider,
        "find_winner",
        program.programId,
        rawCircuit,
        true,
        500,
        {
          skipPreflight: true,
          preflightCommitment: "confirmed",
          commitment: "confirmed",
        }
      );
    });
    console.log("find_winner comp def initialized + circuit uploaded.");
  }
});

async function withBlockhashRetry<T>(
  label: string,
  fn: () => Promise<T>,
  maxRetries: number = 5,
  retryDelayMs: number = 500
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("Blockhash not found") || attempt === maxRetries) {
        throw error;
      }

      console.warn(
        `${label} hit a stale blockhash on attempt ${attempt}/${maxRetries}; retrying...`
      );
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`${label} failed after ${maxRetries} attempts`);
}

async function waitForAuctionWinnerState(
  program: Program<Vickreynftauction>,
  connection: anchor.web3.Connection,
  auction: PublicKey,
  finalizeSig: string,
  computationAccount: PublicKey,
  timeoutMs: number = 30_000,
  pollIntervalMs: number = 1_000
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const auctionAcc = await program.account.auctionConfig.fetch(auction);
    const state = JSON.stringify(auctionAcc.state);
    if (state !== JSON.stringify({ computationPending: {} })) {
      return auctionAcc;
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  const finalizeTx = await connection.getTransaction(finalizeSig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (finalizeTx?.meta?.logMessages) {
    console.error("Finalization transaction logs:");
    for (const log of finalizeTx.meta.logMessages) {
      console.error(log);
    }
  }

  const auctionSigs = await connection.getSignaturesForAddress(
    auction,
    { limit: 5 },
    "confirmed"
  );
  console.error(
    "Recent auction signatures:",
    auctionSigs.map((sig) => sig.signature)
  );

  const compSigs = await connection.getSignaturesForAddress(
    computationAccount,
    { limit: 5 },
    "confirmed"
  );
  console.error(
    "Recent computation signatures:",
    compSigs.map((sig) => sig.signature)
  );
  for (const sig of compSigs.slice(0, 3)) {
    const tx = await connection.getTransaction(sig.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (tx?.meta?.logMessages) {
      console.error(`Logs for computation signature ${sig.signature}:`);
      for (const log of tx.meta.logMessages) {
        console.error(log);
      }
    }
  }

  throw new Error(
    `Auction callback did not update state within ${timeoutMs}ms`
  );
}

async function createMetaplexNft(
  connection: anchor.web3.Connection,
  payer: Keypair,
  mintKeypair: Keypair
): Promise<PublicKey> {
  // Mint with decimals=0, supply will become 1 after mintTo.
  const mint = await createMint(
    connection,
    payer,
    payer.publicKey,
    payer.publicKey,
    0,
    mintKeypair
  );
  const ata = await createAssociatedTokenAccount(
    connection,
    payer,
    mint,
    payer.publicKey
  );
  await mintTo(connection, payer, mint, ata, payer, 1);

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
          name: "TestNFT",
          symbol: "TNFT",
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
  const tx = new Transaction().add(ix);
  await sendAndConfirmTransaction(connection, tx, [payer]);
  return mint;
}

async function getMXEPublicKeyWithRetry(
  provider: anchor.AnchorProvider,
  programId: PublicKey,
  maxRetries: number = 20,
  retryDelayMs: number = 500
): Promise<Uint8Array> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const mxePublicKey = await getMXEPublicKey(provider, programId);
      if (mxePublicKey) return mxePublicKey;
    } catch (_) {
      // ignore, will retry
    }
    if (attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }
  throw new Error(
    `Failed to fetch MXE public key after ${maxRetries} attempts`
  );
}

function readKpJson(path: string): anchor.web3.Keypair {
  const file = fs.readFileSync(path);
  return anchor.web3.Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(file.toString()))
  );
}
