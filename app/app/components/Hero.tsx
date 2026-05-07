import Link from "next/link";
import { ArrowRight, Lock, Sparkles } from "lucide-react";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 -z-10">
        <div className="absolute -left-32 top-0 h-96 w-96 rounded-full bg-accent/30 blur-3xl" />
        <div className="absolute right-0 top-32 h-96 w-96 rounded-full bg-fuchsia-700/20 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(255,255,255,0.05),_transparent_60%)]" />
      </div>

      <div className="mx-auto max-w-7xl px-6 pb-16 pt-20 sm:pt-28">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-zinc-300 backdrop-blur">
          <Sparkles size={12} className="text-accent" />
          Powered by Arcium MPC on Solana
        </div>

        <h1 className="mt-6 max-w-3xl text-5xl font-semibold leading-[1.05] tracking-tight text-white sm:text-6xl md:text-7xl">
          Private NFT auctions.{" "}
          <span className="bg-gradient-to-r from-accent via-fuchsia-400 to-pink-400 bg-clip-text text-transparent">
            Sealed by default.
          </span>
        </h1>

        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-zinc-400">
          Bidders' amounts stay encrypted client-side. The MPC network finds
          the winner without anyone — not even the seller — seeing the losing
          bids. Settlement runs as a Vickrey second-price auction.
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Link
            href="/create"
            className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-accent/30 transition hover:bg-accent-hover"
          >
            Create an auction <ArrowRight size={16} />
          </Link>
          <a
            href="#auctions"
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-medium text-white backdrop-blur transition hover:bg-white/10"
          >
            <Lock size={14} /> Explore live auctions
          </a>
        </div>
      </div>
    </section>
  );
}
