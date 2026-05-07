"use client";

import { useState } from "react";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { AnchorProvider } from "@coral-xyz/anchor";
import BN from "bn.js";
import { Loader2, Lock, Info } from "lucide-react";
import { toast } from "sonner";
import { useVickreyProgram } from "../lib/program";
import { encryptBid, getMXEPublicKeyWithRetry } from "../lib/encryption";
import { bidderRecordPda, solEscrowPda } from "../lib/pdas";
import { PROGRAM_ID } from "../lib/constants";

export function BidForm({
  auction,
  onSubmitted,
}: {
  auction: PublicKey;
  onSubmitted: () => void;
}) {
  const { publicKey, signTransaction, signAllTransactions } = useWallet();
  const { connection } = useConnection();
  const program = useVickreyProgram();

  const [bid, setBid] = useState("");
  const [max, setMax] = useState("");
  const [busy, setBusy] = useState(false);

  const bidNum = parseFloat(bid);
  const maxNum = parseFloat(max);
  const valid =
    !!publicKey &&
    !isNaN(bidNum) &&
    !isNaN(maxNum) &&
    bidNum > 0 &&
    maxNum >= bidNum;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || !publicKey || !signTransaction) return;
    setBusy(true);
    const toastId = toast.loading("Encrypting your bid...");
    try {
      const provider = new AnchorProvider(
        connection,
        {
          publicKey,
          signTransaction,
          signAllTransactions: signAllTransactions!,
        } as any,
        { commitment: "confirmed" }
      );
      const mxe = await getMXEPublicKeyWithRetry(provider, PROGRAM_ID);

      const bidLamports = BigInt(Math.round(bidNum * LAMPORTS_PER_SOL));
      const maxLamports = BigInt(Math.round(maxNum * LAMPORTS_PER_SOL));

      const enc = encryptBid(bidLamports, mxe, true);

      // Defensive: keep the ephemeral private key locally so future flows
      // (e.g. user-side decryption) have access.
      try {
        localStorage.setItem(
          `bid:${auction.toBase58()}:${publicKey.toBase58()}`,
          JSON.stringify({
            privKeyHex: enc.privKeyHex,
            createdAt: Date.now(),
          })
        );
      } catch {
        // localStorage unavailable in some browsing modes — non-fatal
      }

      toast.loading("Submitting sealed bid...", { id: toastId });

      const sig = await program.methods
        .submitBid(
          enc.ciphertext0,
          enc.ciphertext1,
          enc.pubKey,
          enc.nonce,
          new BN(maxLamports.toString())
        )
        .accountsPartial({
          bidder: publicKey,
          auctionConfig: auction,
          bidderRecord: bidderRecordPda(auction, publicKey),
          solEscrow: solEscrowPda(auction),
          systemProgram: SystemProgram.programId,
        })
        .rpc({ skipPreflight: false, commitment: "confirmed" });

      toast.success("Sealed bid submitted!", {
        id: toastId,
        description: sig.slice(0, 16) + "...",
      });
      setBid("");
      setMax("");
      onSubmitted();
    } catch (err: any) {
      console.error(err);
      const msg = parseError(err);
      toast.error("Bid failed", { id: toastId, description: msg });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-medium uppercase tracking-wider text-zinc-400">
          Sealed bid (SOL)
        </label>
        <input
          type="number"
          step="0.0001"
          min="0"
          value={bid}
          onChange={(e) => setBid(e.target.value)}
          placeholder="2.5"
          className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none transition focus:border-accent/60 focus:ring-2 focus:ring-accent/20"
        />
        <p className="mt-1 text-xs text-zinc-500">
          Encrypted in your browser. Never seen by anyone.
        </p>
      </div>

      <div>
        <label className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-zinc-400">
          Max collateral (SOL)
          <span className="group relative">
            <Info size={12} className="text-zinc-500" />
            <span className="invisible absolute bottom-full left-1/2 z-10 mb-1 w-64 -translate-x-1/2 rounded-lg border border-white/10 bg-zinc-900 p-2 text-[11px] font-normal normal-case text-zinc-300 opacity-0 shadow-xl transition group-hover:visible group-hover:opacity-100">
              Public upper bound on your bid. Locked in escrow now and
              partially refunded if you win at the second-highest price, or
              fully refunded if you lose. Your real bid stays sealed.
            </span>
          </span>
        </label>
        <input
          type="number"
          step="0.0001"
          min="0"
          value={max}
          onChange={(e) => setMax(e.target.value)}
          placeholder="3.0"
          className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none transition focus:border-accent/60 focus:ring-2 focus:ring-accent/20"
        />
        <p className="mt-1 text-xs text-zinc-500">
          Must be ≥ your bid. Visible on-chain — choose a generous round
          number to avoid leaking the exact amount.
        </p>
      </div>

      <button
        type="submit"
        disabled={!valid || busy}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-accent/20 transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? (
          <>
            <Loader2 size={16} className="animate-spin" /> Submitting...
          </>
        ) : (
          <>
            <Lock size={14} /> Place sealed bid
          </>
        )}
      </button>
    </form>
  );
}

function parseError(err: any): string {
  if (err?.error?.errorMessage) return err.error.errorMessage;
  if (typeof err?.message === "string") {
    if (err.message.includes("User rejected")) return "Wallet rejected the request";
    if (err.message.length > 240) return err.message.slice(0, 240) + "...";
    return err.message;
  }
  return "Unknown error";
}
