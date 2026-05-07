"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { PROGRAM_ID as METADATA_PROGRAM_ID } from "@metaplex-foundation/mpl-token-metadata";
import BN from "bn.js";
import {
  Loader2,
  AlertCircle,
  ImageIcon,
  Lock,
  Wallet,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import { useVickreyProgram } from "../lib/program";
import {
  auctionPda,
  metadataPda,
  nftAuthorityPda,
} from "../lib/pdas";
import { fetchNftMetadata, type NftMetadata } from "../lib/metadata";
import { truncateAddress } from "../lib/format";

type DurationOption =
  | { kind: "preset"; minutes: number; label: string }
  | { kind: "custom" };

const PRESETS: DurationOption[] = [
  { kind: "preset", minutes: 60, label: "1 hour" },
  { kind: "preset", minutes: 360, label: "6 hours" },
  { kind: "preset", minutes: 1440, label: "24 hours" },
  { kind: "custom" },
];

export default function CreateAuctionPage() {
  const router = useRouter();
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const program = useVickreyProgram();

  const [mintInput, setMintInput] = useState("");
  const [mint, setMint] = useState<PublicKey | null>(null);
  const [meta, setMeta] = useState<NftMetadata | null>(null);
  const [metaLoading, setMetaLoading] = useState(false);
  const [duration, setDuration] = useState<DurationOption>(PRESETS[2]);
  const [customMin, setCustomMin] = useState<string>("60");
  const [busy, setBusy] = useState(false);

  // Validate the mint as the user types and load metadata.
  useEffect(() => {
    setMint(null);
    setMeta(null);
    if (!mintInput.trim()) return;
    let pk: PublicKey;
    try {
      pk = new PublicKey(mintInput.trim());
    } catch {
      return;
    }
    setMint(pk);
    setMetaLoading(true);
    fetchNftMetadata(connection, pk)
      .then(setMeta)
      .finally(() => setMetaLoading(false));
  }, [mintInput, connection]);

  const minutes =
    duration.kind === "preset"
      ? duration.minutes
      : Math.max(1, parseInt(customMin) || 0);
  const validDuration = minutes > 0;
  const canSubmit = !!publicKey && !!mint && validDuration && !busy;

  async function handleCreate() {
    if (!publicKey || !mint) return;
    setBusy(true);
    const toastId = toast.loading("Creating auction...");
    try {
      const auction = auctionPda(publicKey, mint);
      const nftAuthority = nftAuthorityPda(auction);
      const sellerNftAccount = getAssociatedTokenAddressSync(
        mint,
        publicKey
      );
      const nftEscrowToken = getAssociatedTokenAddressSync(
        mint,
        nftAuthority,
        true
      );
      const nftMetadata = metadataPda(mint);

      const endTs = new BN(Math.floor(Date.now() / 1000) + minutes * 60);

      const sig = await program.methods
        .createAuction(endTs)
        .accountsPartial({
          seller: publicKey,
          nftMint: mint,
          nftMetadata,
          sellerNftAccount,
          nftEscrowAuthority: nftAuthority,
          nftEscrowTokenAccount: nftEscrowToken,
          auctionConfig: auction,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          metadataProgram: METADATA_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ skipPreflight: false, commitment: "confirmed" });

      toast.success("Auction created!", {
        id: toastId,
        description: sig.slice(0, 16) + "...",
      });
      router.push(`/auction/${auction.toBase58()}`);
    } catch (err: any) {
      console.error(err);
      const msg = parseError(err);
      toast.error("Failed to create auction", {
        id: toastId,
        description: msg,
      });
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
        Create an auction
      </h1>
      <p className="mt-2 max-w-xl text-zinc-400">
        Escrow your NFT and let bidders place sealed bids. Settlement runs as a
        Vickrey second-price auction the moment the timer ends.
      </p>

      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        {/* Form */}
        <div className="space-y-6 rounded-2xl border border-white/5 bg-white/[0.02] p-6">
          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-zinc-400">
              NFT mint address
            </label>
            <input
              value={mintInput}
              onChange={(e) => setMintInput(e.target.value)}
              placeholder="Paste NFT mint pubkey (Metaplex classic, supply=1, decimals=0)"
              className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 font-mono text-sm text-white outline-none transition focus:border-accent/60 focus:ring-2 focus:ring-accent/20"
            />
            {mintInput && !mint && (
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-red-400">
                <AlertCircle size={12} /> Not a valid base58 pubkey
              </p>
            )}
          </div>

          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-zinc-400">
              Duration
            </label>
            <div className="mt-1.5 grid grid-cols-4 gap-2">
              {PRESETS.map((opt, i) => {
                const selected =
                  (opt.kind === "preset" &&
                    duration.kind === "preset" &&
                    duration.minutes === opt.minutes) ||
                  (opt.kind === "custom" && duration.kind === "custom");
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setDuration(opt)}
                    className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
                      selected
                        ? "border-accent/50 bg-accent/10 text-white"
                        : "border-white/10 bg-white/[0.02] text-zinc-400 hover:bg-white/5"
                    }`}
                  >
                    {opt.kind === "preset" ? opt.label : "Custom"}
                  </button>
                );
              })}
            </div>
            {duration.kind === "custom" && (
              <div className="mt-3">
                <label className="text-xs text-zinc-500">
                  Custom duration (minutes)
                </label>
                <input
                  type="number"
                  min="1"
                  value={customMin}
                  onChange={(e) => setCustomMin(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none transition focus:border-accent/60 focus:ring-2 focus:ring-accent/20"
                />
              </div>
            )}
          </div>

          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-xs text-zinc-400">
            <div className="flex items-center gap-1.5">
              <Lock size={12} className="text-accent" />
              Maximum 8 sealed bids per auction. Bids are final — no
              edits, no top-ups.
            </div>
          </div>

          {!publicKey ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-sm text-zinc-400">
              <Wallet size={14} /> Connect a wallet to create an auction
            </div>
          ) : (
            <button
              onClick={handleCreate}
              disabled={!canSubmit}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-accent/20 transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Creating...
                </>
              ) : (
                <>Create auction</>
              )}
            </button>
          )}
        </div>

        {/* Preview */}
        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
            Preview
          </h3>
          <div className="mt-4 overflow-hidden rounded-xl border border-white/5 bg-zinc-900">
            {mint ? (
              <div className="relative aspect-square w-full overflow-hidden bg-zinc-900">
                {meta?.image ? (
                  <Image
                    src={meta.image}
                    alt={meta.name || "NFT"}
                    fill
                    sizes="50vw"
                    className="object-cover"
                    unoptimized
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <ImageIcon size={48} className="text-zinc-700" />
                  </div>
                )}
              </div>
            ) : (
              <div className="flex aspect-square items-center justify-center">
                <ImageIcon size={48} className="text-zinc-700" />
              </div>
            )}
            <div className="space-y-2 p-4">
              {metaLoading ? (
                <p className="text-sm text-zinc-500">Loading metadata...</p>
              ) : (
                <>
                  <h4 className="font-semibold text-white">
                    {meta?.name ||
                      (mint
                        ? `NFT ${mint.toBase58().slice(0, 4)}`
                        : "No NFT selected")}
                  </h4>
                  {mint && (
                    <p className="font-mono text-xs text-zinc-500">
                      {truncateAddress(mint, 6)}
                    </p>
                  )}
                </>
              )}
              {validDuration && (
                <p className="flex items-center gap-1.5 pt-1 text-xs text-zinc-400">
                  <Clock size={12} /> Ends in{" "}
                  {minutes >= 60
                    ? `${(minutes / 60).toFixed(1)} hours`
                    : `${minutes} minutes`}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function parseError(err: any): string {
  if (err?.error?.errorMessage) return err.error.errorMessage;
  if (typeof err?.message === "string") {
    if (err.message.includes("User rejected"))
      return "Wallet rejected the request";
    if (err.message.includes("InvalidNftMintSupply"))
      return "Mint supply must be exactly 1";
    if (err.message.includes("InvalidNftMintDecimals"))
      return "Mint decimals must be 0";
    if (err.message.includes("ProgrammableNftNotSupported"))
      return "Programmable NFTs are not supported";
    if (err.message.includes("AccountNotInitialized"))
      return "NFT mint or metadata account doesn't exist";
    if (err.message.length > 240) return err.message.slice(0, 240) + "...";
    return err.message;
  }
  return "Unknown error";
}
