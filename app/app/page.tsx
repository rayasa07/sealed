"use client";

import { Hero } from "./components/Hero";
import { AuctionCard } from "./components/AuctionCard";
import { AuctionCardSkeleton } from "./components/Skeleton";
import { useAuctions } from "./lib/auction";
import Link from "next/link";
import { Plus, AlertTriangle } from "lucide-react";

export default function HomePage() {
  const { auctions, loading, error } = useAuctions();

  return (
    <>
      <Hero />

      <section
        id="auctions"
        className="mx-auto max-w-7xl px-6 pb-16 pt-8 sm:pt-16"
      >
        <div className="mb-8 flex items-end justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Live auctions
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Discovered on-chain from program{" "}
              <span className="font-mono text-zinc-400">6K6a...YS1e</span>
            </p>
          </div>
          <Link
            href="/create"
            className="hidden items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/10 sm:inline-flex"
          >
            <Plus size={14} /> New auction
          </Link>
        </div>

        {loading && (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <AuctionCardSkeleton key={i} />
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="flex items-start gap-3 rounded-2xl border border-red-500/20 bg-red-500/5 p-5">
            <AlertTriangle size={18} className="mt-0.5 text-red-400" />
            <div>
              <p className="font-medium text-white">
                Couldn't load auctions
              </p>
              <p className="mt-1 text-sm text-zinc-400">{error}</p>
              <p className="mt-2 text-xs text-zinc-500">
                If you're using the public devnet RPC you may be rate-limited.
                Set <code className="rounded bg-white/5 px-1">NEXT_PUBLIC_RPC_URL</code>{" "}
                in <code className="rounded bg-white/5 px-1">.env.local</code>{" "}
                to a Helius / QuickNode endpoint.
              </p>
            </div>
          </div>
        )}

        {!loading && !error && (auctions?.length ?? 0) === 0 && (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-12 text-center">
            <p className="text-lg font-medium text-white">
              No active auctions yet
            </p>
            <p className="mt-1 text-sm text-zinc-500">
              Be the first to put an NFT up for sealed bidding.
            </p>
            <Link
              href="/create"
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-accent/20 transition hover:bg-accent-hover"
            >
              <Plus size={14} /> Create the first auction
            </Link>
          </div>
        )}

        {!loading && !error && (auctions?.length ?? 0) > 0 && (
          <div className="grid animate-fade-in grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {auctions!.map((a) => (
              <AuctionCard key={a.publicKey.toBase58()} auction={a} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
