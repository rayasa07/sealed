"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import BN from "bn.js";
import {
  AlertTriangle,
  ArrowLeft,
  Clock,
  Crown,
  Loader2,
  Lock,
  RefreshCw,
  Trophy,
  Users,
  Wallet,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { useVickreyProgram } from "../../lib/program";
import {
  bidderRecordPda,
  nftAuthorityPda,
  solEscrowPda,
} from "../../lib/pdas";
import {
  useAuction,
  useBidderRecords,
  useMyBidderRecord,
  type AuctionAccount,
  type BidderRecordWithKey,
} from "../../lib/auction";
import { fetchNftMetadata, type NftMetadata } from "../../lib/metadata";
import {
  formatSol,
  stateBadgeClass,
  stateToLabel,
  truncateAddress,
} from "../../lib/format";
import { CountdownTimer } from "../../components/CountdownTimer";
import { BidForm } from "../../components/BidForm";
import { HowItWorks } from "../../components/HowItWorks";
import { Skeleton } from "../../components/Skeleton";
import { arciumQueueAccounts } from "../../lib/arcium";
import { PROGRAM_ID } from "../../lib/constants";

export default function AuctionDetailPage({
  params,
}: {
  params: { address: string };
}) {
  const { address } = params;
  let auctionKey: PublicKey | null = null;
  try {
    auctionKey = new PublicKey(address);
  } catch {
    auctionKey = null;
  }

  if (!auctionKey) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-24 text-center">
        <h1 className="text-2xl font-semibold text-white">Invalid auction</h1>
        <p className="mt-2 text-zinc-400">
          The address in the URL is not a valid Solana pubkey.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-white"
        >
          <ArrowLeft size={14} /> Back to auctions
        </Link>
      </div>
    );
  }

  return <AuctionDetail auctionKey={auctionKey} />;
}

function AuctionDetail({ auctionKey }: { auctionKey: PublicKey }) {
  const { connection } = useConnection();
  const { auction, loading, error } = useAuction(auctionKey);
  const { records, refresh: refreshRecords } = useBidderRecords(auctionKey);
  const { publicKey } = useWallet();
  const { record: myRecord, refresh: refreshMyRecord } = useMyBidderRecord(
    auctionKey,
    publicKey ?? null
  );
  const [meta, setMeta] = useState<NftMetadata | null>(null);

  useEffect(() => {
    if (!auction) return;
    fetchNftMetadata(connection, auction.nftMint as PublicKey).then(setMeta);
  }, [connection, auction]);

  if (loading) return <AuctionLoading />;
  if (error || !auction) return <AuctionError error={error} />;

  const stateLabel = stateToLabel(auction.state);
  const endTs = auction.endTs.toNumber();
  const now = Math.floor(Date.now() / 1000);
  const expired = now >= endTs;
  const isSeller =
    !!publicKey && publicKey.equals(auction.seller as PublicKey);
  const winnerRecord =
    records?.find((r) => r.account.bidderIndex === auction.winnerBidderIndex) ??
    null;
  const isWinner =
    !!publicKey &&
    !!winnerRecord &&
    publicKey.equals(winnerRecord.account.bidder as PublicKey) &&
    auction.hasValidWinner;

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-zinc-400 transition hover:text-white"
      >
        <ArrowLeft size={14} /> All auctions
      </Link>

      <div className="mt-6 grid gap-10 lg:grid-cols-2">
        {/* Left: NFT */}
        <div>
          <div className="overflow-hidden rounded-3xl border border-white/5 bg-zinc-900 shadow-2xl">
            <div className="relative aspect-square w-full">
              {meta?.image && (
                <Image
                  src={meta.image}
                  alt={meta.name || "NFT"}
                  fill
                  priority
                  sizes="(max-width: 1024px) 100vw, 50vw"
                  className="object-cover"
                  unoptimized
                />
              )}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${stateBadgeClass(stateLabel)}`}
            >
              {stateLabel}
            </span>
            {meta?.symbol && (
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-zinc-300">
                {meta.symbol}
              </span>
            )}
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            {meta?.name || `NFT ${auction.nftMint.toBase58().slice(0, 4)}`}
          </h1>
          {meta?.description && (
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-zinc-400">
              {meta.description}
            </p>
          )}
          <dl className="mt-6 grid grid-cols-2 gap-4 rounded-2xl border border-white/5 bg-white/[0.02] p-5 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wider text-zinc-500">
                Seller
              </dt>
              <dd className="mt-1 font-mono text-zinc-200">
                {truncateAddress(auction.seller as PublicKey)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-zinc-500">
                Mint
              </dt>
              <dd className="mt-1 font-mono text-zinc-200">
                {truncateAddress(auction.nftMint as PublicKey)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-zinc-500">
                Bids submitted
              </dt>
              <dd className="mt-1 text-zinc-200">{auction.bidCount} / 8</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-zinc-500">
                Ends
              </dt>
              <dd className="mt-1 text-zinc-200">
                {new Date(endTs * 1000).toLocaleString()}
              </dd>
            </div>
          </dl>
        </div>

        {/* Right: countdown, action panel, bidder list */}
        <div className="space-y-6">
          <ActionPanel
            auctionKey={auctionKey}
            auction={auction}
            records={records}
            myRecord={myRecord}
            isSeller={isSeller}
            isWinner={isWinner}
            winnerRecord={winnerRecord}
            expired={expired}
            onAction={() => {
              refreshRecords();
              refreshMyRecord();
            }}
          />
          <BidderList records={records} myWallet={publicKey ?? null} />
          <HowItWorks />
        </div>
      </div>
    </div>
  );
}

function AuctionLoading() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <Skeleton className="h-4 w-32" />
      <div className="mt-6 grid gap-10 lg:grid-cols-2">
        <Skeleton className="aspect-square rounded-3xl" />
        <div className="space-y-6">
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}

function AuctionError({ error }: { error: string | null }) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-24 text-center">
      <AlertTriangle size={32} className="mx-auto text-red-400" />
      <h1 className="mt-4 text-2xl font-semibold text-white">
        Auction not found
      </h1>
      <p className="mt-2 text-zinc-400">
        {error ||
          "We couldn't fetch this auction. It may not exist on this cluster."}
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-white"
      >
        <ArrowLeft size={14} /> Back to auctions
      </Link>
    </div>
  );
}

function ActionPanel({
  auctionKey,
  auction,
  records,
  myRecord,
  isSeller,
  isWinner,
  winnerRecord,
  expired,
  onAction,
}: {
  auctionKey: PublicKey;
  auction: AuctionAccount;
  records: BidderRecordWithKey[] | null;
  myRecord: any;
  isSeller: boolean;
  isWinner: boolean;
  winnerRecord: BidderRecordWithKey | null;
  expired: boolean;
  onAction: () => void;
}) {
  const { publicKey } = useWallet();
  const stateLabel = stateToLabel(auction.state);
  const endTs = auction.endTs.toNumber();

  // ---- Settled ----
  if (stateLabel === "Settled") {
    return (
      <SettledPanel
        auction={auction}
        winnerRecord={winnerRecord}
        myRecord={myRecord}
        auctionKey={auctionKey}
        onAction={onAction}
      />
    );
  }

  // ---- Winner computed (ready to settle) ----
  if (stateLabel === "Winner Computed") {
    return (
      <WinnerComputedPanel
        auction={auction}
        winnerRecord={winnerRecord}
        auctionKey={auctionKey}
        isWinner={isWinner}
        onAction={onAction}
      />
    );
  }

  // ---- Computation pending ----
  if (stateLabel === "Computation Pending") {
    return (
      <Panel>
        <div className="flex items-center gap-3">
          <Loader2 size={20} className="animate-spin text-accent" />
          <div>
            <p className="font-semibold text-white">MPC computing...</p>
            <p className="text-sm text-zinc-400">
              The Arcium network is finding the winner. This usually takes
              20–60 seconds. The page will update automatically.
            </p>
          </div>
        </div>
      </Panel>
    );
  }

  // ---- Failure / emergency states ----
  if (
    stateLabel === "Computation Failed" ||
    stateLabel === "Emergency Closed"
  ) {
    return (
      <EmergencyPanel
        auction={auction}
        auctionKey={auctionKey}
        myRecord={myRecord}
        isSeller={isSeller}
        onAction={onAction}
      />
    );
  }

  // ---- Past end_ts but still Active/BiddingClosed: compute winner ----
  if (expired) {
    return (
      <ComputeWinnerPanel
        auction={auction}
        records={records}
        auctionKey={auctionKey}
        onAction={onAction}
      />
    );
  }

  // ---- Active and accepting bids ----
  return (
    <Panel>
      <div className="flex items-center justify-between border-b border-white/5 pb-4">
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <Clock size={14} className="text-accent" />
          <span>Auction ends in</span>
        </div>
        <CountdownTimer
          endTs={endTs}
          className="font-mono text-lg font-semibold text-white"
        />
      </div>
      <div className="pt-5">
        {!publicKey ? (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-sm text-zinc-400">
            <Wallet size={14} /> Connect a wallet to place a sealed bid
          </div>
        ) : myRecord ? (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm">
            <div className="flex items-center gap-2 font-medium text-emerald-300">
              <Lock size={14} /> Your sealed bid is in
            </div>
            <p className="mt-1.5 text-zinc-400">
              Max collateral locked:{" "}
              <span className="text-white">
                {formatSol(myRecord.maxCollateral)}
              </span>
              . Your actual bid amount stays encrypted.
            </p>
          </div>
        ) : auction.bidCount >= 8 ? (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-300">
            This auction has reached the 8-bidder cap.
          </div>
        ) : (
          <BidForm auction={auctionKey} onSubmitted={onAction} />
        )}
      </div>
    </Panel>
  );
}

function ComputeWinnerPanel({
  auction,
  records,
  auctionKey,
  onAction,
}: {
  auction: AuctionAccount;
  records: BidderRecordWithKey[] | null;
  auctionKey: PublicKey;
  onAction: () => void;
}) {
  const program = useVickreyProgram();
  const { publicKey } = useWallet();
  const [busy, setBusy] = useState(false);

  async function handleCompute() {
    if (!publicKey || !records) return;
    setBusy(true);
    const toastId = toast.loading("Submitting MPC computation...");
    try {
      const ordered = [...records].sort(
        (a, b) => a.account.bidderIndex - b.account.bidderIndex
      );
      const remainingAccounts = ordered.map((r) => ({
        pubkey: r.publicKey,
        isSigner: false,
        isWritable: false,
      }));

      // Random 8-byte computation offset (matches the test pattern).
      const offsetBytes = new Uint8Array(8);
      if (typeof window !== "undefined") {
        window.crypto.getRandomValues(offsetBytes);
      }
      const computationOffset = new BN(Buffer.from(offsetBytes), "hex");

      const queueAccs = arciumQueueAccounts(
        PROGRAM_ID,
        computationOffset,
        "find_winner"
      );

      const sig = await program.methods
        .queueFindWinner(computationOffset)
        .accountsPartial({
          payer: publicKey,
          auctionConfig: auctionKey,
          ...queueAccs,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(remainingAccounts)
        .rpc({ skipPreflight: false, commitment: "confirmed" });

      toast.success("Computation queued — waiting for callback", {
        id: toastId,
        description: sig.slice(0, 16) + "...",
      });
      onAction();
    } catch (err: any) {
      console.error(err);
      toast.error("Failed to queue computation", {
        id: toastId,
        description: parseError(err),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <div className="flex items-start gap-3">
        <Sparkles size={20} className="mt-0.5 text-accent" />
        <div className="flex-1">
          <p className="font-semibold text-white">Bidding has ended</p>
          <p className="mt-1 text-sm text-zinc-400">
            Trigger the MPC network to find the winner without revealing the
            losing bids. Anyone can do this.
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <Stat label="Total bids" value={`${auction.bidCount} / 8`} />
        <Stat
          label="Ended"
          value={new Date(auction.endTs.toNumber() * 1000).toLocaleTimeString()}
        />
      </div>

      <button
        onClick={handleCompute}
        disabled={busy || !publicKey || !records}
        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-accent/20 transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? (
          <>
            <Loader2 size={16} className="animate-spin" /> Submitting...
          </>
        ) : !publicKey ? (
          <>
            <Wallet size={14} /> Connect wallet to compute winner
          </>
        ) : (
          <>
            <Sparkles size={14} /> Compute winner
          </>
        )}
      </button>
    </Panel>
  );
}

function WinnerComputedPanel({
  auction,
  winnerRecord,
  auctionKey,
  isWinner,
  onAction,
}: {
  auction: AuctionAccount;
  winnerRecord: BidderRecordWithKey | null;
  auctionKey: PublicKey;
  isWinner: boolean;
  onAction: () => void;
}) {
  const program = useVickreyProgram();
  const { publicKey } = useWallet();
  const [busy, setBusy] = useState(false);

  async function handleSettle() {
    if (!publicKey || !winnerRecord) return;
    setBusy(true);
    const toastId = toast.loading("Settling auction...");
    try {
      const winner = winnerRecord.account.bidder as PublicKey;
      const winnerNftAta = getAssociatedTokenAddressSync(
        auction.nftMint as PublicKey,
        winner
      );

      const sig = await program.methods
        .settleAuction()
        .accountsPartial({
          caller: publicKey,
          auctionConfig: auctionKey,
          winnerRecord: winnerRecord.publicKey,
          winner,
          seller: auction.seller,
          solEscrow: solEscrowPda(auctionKey),
          nftEscrowTokenAccount: auction.nftEscrowTokenAccount,
          winnerNftAccount: winnerNftAta,
          nftMint: auction.nftMint,
          nftEscrowAuthority: nftAuthorityPda(auctionKey),
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ skipPreflight: false, commitment: "confirmed" });

      toast.success("Settled!", {
        id: toastId,
        description: sig.slice(0, 16) + "...",
      });
      onAction();
    } catch (err: any) {
      console.error(err);
      toast.error("Settlement failed", {
        id: toastId,
        description: parseError(err),
      });
    } finally {
      setBusy(false);
    }
  }

  if (!auction.hasValidWinner) {
    return (
      <Panel>
        <div className="flex items-center gap-3">
          <AlertTriangle size={20} className="text-amber-400" />
          <div>
            <p className="font-semibold text-white">No valid winner</p>
            <p className="text-sm text-zinc-400">
              All bids exceeded their declared collateral. Bidders can claim
              emergency refunds; the seller can reclaim the NFT.
            </p>
          </div>
        </div>
      </Panel>
    );
  }

  return (
    <Panel>
      <div className="flex items-start gap-3">
        <Trophy size={20} className="mt-0.5 text-amber-300" />
        <div className="flex-1">
          <p className="font-semibold text-white">Winner found</p>
          <p className="text-sm text-zinc-400">
            The MPC network has revealed the winner and second-highest price.
            Settlement is permissionless.
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <Stat
          label="Winner"
          value={
            winnerRecord
              ? truncateAddress(winnerRecord.account.bidder as PublicKey)
              : `Bidder #${auction.winnerBidderIndex}`
          }
          mono
        />
        <Stat
          label="Final price"
          value={formatSol(auction.secondPrice, 4)}
          highlight
        />
      </div>

      <button
        onClick={handleSettle}
        disabled={busy || !publicKey || !winnerRecord}
        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-accent/20 transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? (
          <>
            <Loader2 size={16} className="animate-spin" /> Settling...
          </>
        ) : !publicKey ? (
          <>
            <Wallet size={14} /> Connect wallet to settle
          </>
        ) : isWinner ? (
          <>
            <Crown size={14} /> Claim NFT &amp; settle
          </>
        ) : (
          <>Settle auction</>
        )}
      </button>
    </Panel>
  );
}

function SettledPanel({
  auction,
  winnerRecord,
  myRecord,
  auctionKey,
  onAction,
}: {
  auction: AuctionAccount;
  winnerRecord: BidderRecordWithKey | null;
  myRecord: any;
  auctionKey: PublicKey;
  onAction: () => void;
}) {
  const program = useVickreyProgram();
  const { publicKey } = useWallet();
  const [busy, setBusy] = useState(false);

  const isMeWinner =
    !!publicKey &&
    !!winnerRecord &&
    publicKey.equals(winnerRecord.account.bidder as PublicKey);
  const canRefund = !!myRecord && !myRecord.refunded && !isMeWinner;

  async function handleRefund() {
    if (!publicKey || !myRecord) return;
    setBusy(true);
    const toastId = toast.loading("Claiming refund...");
    try {
      const sig = await program.methods
        .refundLoser()
        .accountsPartial({
          caller: publicKey,
          auctionConfig: auctionKey,
          bidderRecord: bidderRecordPda(auctionKey, publicKey),
          bidder: publicKey,
          solEscrow: solEscrowPda(auctionKey),
          systemProgram: SystemProgram.programId,
        })
        .rpc({ skipPreflight: false, commitment: "confirmed" });
      toast.success("Refunded!", {
        id: toastId,
        description: sig.slice(0, 16) + "...",
      });
      onAction();
    } catch (err: any) {
      console.error(err);
      toast.error("Refund failed", {
        id: toastId,
        description: parseError(err),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <div className="flex items-start gap-3">
        <Trophy size={20} className="mt-0.5 text-amber-300" />
        <div className="flex-1">
          <p className="font-semibold text-white">Settled</p>
          <p className="text-sm text-zinc-400">
            NFT delivered to the winner. Sealed bids never revealed.
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <Stat
          label="Winner"
          value={
            winnerRecord
              ? truncateAddress(winnerRecord.account.bidder as PublicKey)
              : `Bidder #${auction.winnerBidderIndex}`
          }
          mono
        />
        <Stat
          label="Final price"
          value={formatSol(auction.secondPrice, 4)}
          highlight
        />
      </div>

      {canRefund && (
        <button
          onClick={handleRefund}
          disabled={busy}
          className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-50"
        >
          {busy ? (
            <>
              <Loader2 size={16} className="animate-spin" /> Refunding...
            </>
          ) : (
            <>
              <RefreshCw size={14} /> Claim refund (
              {formatSol(myRecord.maxCollateral)})
            </>
          )}
        </button>
      )}

      {!!myRecord && myRecord.refunded && (
        <p className="mt-5 text-center text-sm text-zinc-500">
          Your collateral has been refunded.
        </p>
      )}
    </Panel>
  );
}

function EmergencyPanel({
  auction,
  auctionKey,
  myRecord,
  isSeller,
  onAction,
}: {
  auction: AuctionAccount;
  auctionKey: PublicKey;
  myRecord: any;
  isSeller: boolean;
  onAction: () => void;
}) {
  const program = useVickreyProgram();
  const { publicKey } = useWallet();
  const [busy, setBusy] = useState(false);

  async function handleEmergencyRefund() {
    if (!publicKey) return;
    setBusy(true);
    const toastId = toast.loading("Claiming emergency refund...");
    try {
      const sig = await program.methods
        .emergencyRefund()
        .accountsPartial({
          bidder: publicKey,
          auctionConfig: auctionKey,
          bidderRecord: bidderRecordPda(auctionKey, publicKey),
          solEscrow: solEscrowPda(auctionKey),
          systemProgram: SystemProgram.programId,
        })
        .rpc({ skipPreflight: false, commitment: "confirmed" });
      toast.success("Refunded!", {
        id: toastId,
        description: sig.slice(0, 16) + "...",
      });
      onAction();
    } catch (err: any) {
      console.error(err);
      toast.error("Refund failed", {
        id: toastId,
        description: parseError(err),
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleReclaim() {
    if (!publicKey) return;
    setBusy(true);
    const toastId = toast.loading("Reclaiming NFT...");
    try {
      const sellerNftAccount = getAssociatedTokenAddressSync(
        auction.nftMint as PublicKey,
        publicKey
      );
      const sig = await program.methods
        .emergencyReclaimNft()
        .accountsPartial({
          seller: publicKey,
          auctionConfig: auctionKey,
          nftEscrowTokenAccount: auction.nftEscrowTokenAccount,
          sellerNftAccount,
          nftMint: auction.nftMint,
          nftEscrowAuthority: nftAuthorityPda(auctionKey),
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ skipPreflight: false, commitment: "confirmed" });
      toast.success("NFT reclaimed!", {
        id: toastId,
        description: sig.slice(0, 16) + "...",
      });
      onAction();
    } catch (err: any) {
      console.error(err);
      toast.error("Reclaim failed", {
        id: toastId,
        description: parseError(err),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <div className="flex items-start gap-3">
        <AlertTriangle size={20} className="mt-0.5 text-amber-400" />
        <div>
          <p className="font-semibold text-white">Emergency state</p>
          <p className="text-sm text-zinc-400">
            The MPC computation didn't complete. Bidders can claim
            emergency refunds; the seller can reclaim the NFT.
          </p>
        </div>
      </div>

      {!!myRecord && !myRecord.refunded && (
        <button
          onClick={handleEmergencyRefund}
          disabled={busy}
          className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-50"
        >
          {busy ? (
            <>
              <Loader2 size={16} className="animate-spin" /> Refunding...
            </>
          ) : (
            <>
              <RefreshCw size={14} /> Emergency refund (
              {formatSol(myRecord.maxCollateral)})
            </>
          )}
        </button>
      )}

      {isSeller && !auction.settled && (
        <button
          onClick={handleReclaim}
          disabled={busy}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-50"
        >
          {busy ? (
            <>
              <Loader2 size={16} className="animate-spin" /> Reclaiming...
            </>
          ) : (
            <>Reclaim NFT</>
          )}
        </button>
      )}
    </Panel>
  );
}

function BidderList({
  records,
  myWallet,
}: {
  records: BidderRecordWithKey[] | null;
  myWallet: PublicKey | null;
}) {
  return (
    <div className="rounded-2xl border border-white/5 bg-white/[0.02]">
      <div className="flex items-center justify-between border-b border-white/5 px-5 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Users size={14} className="text-zinc-400" />
          Bidders
        </h3>
        <span className="text-xs text-zinc-500">
          {records?.length ?? 0} sealed
        </span>
      </div>
      <div className="divide-y divide-white/5">
        {!records ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
          </div>
        ) : records.length === 0 ? (
          <p className="px-5 py-4 text-sm text-zinc-500">
            No bids yet. Be the first.
          </p>
        ) : (
          records.map((r) => {
            const isMe =
              myWallet &&
              myWallet.equals(r.account.bidder as PublicKey);
            return (
              <div
                key={r.publicKey.toBase58()}
                className="flex items-center justify-between px-5 py-3 text-sm"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-white/5 font-mono text-[11px] text-zinc-300">
                    #{r.account.bidderIndex}
                  </span>
                  <div>
                    <p className="font-mono text-zinc-200">
                      {truncateAddress(r.account.bidder as PublicKey)}
                      {isMe && (
                        <span className="ml-2 text-[10px] uppercase tracking-wider text-accent">
                          you
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-zinc-500">
                      Bid is sealed
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-zinc-400">
                    Max{" "}
                    <span className="text-white">
                      {formatSol(r.account.maxCollateral, 2)}
                    </span>
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-6">
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
  highlight,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
      <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </p>
      <p
        className={`mt-1 text-sm ${mono ? "font-mono" : ""} ${highlight ? "text-accent-soft" : "text-white"}`}
      >
        {value}
      </p>
    </div>
  );
}

function parseError(err: any): string {
  if (err?.error?.errorMessage) return err.error.errorMessage;
  if (typeof err?.message === "string") {
    if (err.message.includes("User rejected"))
      return "Wallet rejected the request";
    if (err.message.length > 240) return err.message.slice(0, 240) + "...";
    return err.message;
  }
  return "Unknown error";
}
