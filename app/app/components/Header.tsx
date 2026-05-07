"use client";

import Link from "next/link";
import { Lock, Plus } from "lucide-react";
import { ConnectWalletButton } from "./ConnectWalletButton";

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-zinc-950/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-purple-700 shadow-lg shadow-accent/20">
            <Lock size={16} className="text-white" />
          </div>
          <span className="text-lg font-semibold tracking-tight text-white">
            Sealed
          </span>
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-zinc-400 md:flex">
          <Link href="/" className="transition hover:text-white">
            Auctions
          </Link>
          <Link href="/create" className="transition hover:text-white">
            Create
          </Link>
          <a
            href="https://docs.arcium.com"
            target="_blank"
            rel="noreferrer"
            className="transition hover:text-white"
          >
            How it works
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href="/create"
            className="hidden items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-white/10 sm:inline-flex"
          >
            <Plus size={14} /> Create
          </Link>
          <ConnectWalletButton />
        </div>
      </div>
    </header>
  );
}
