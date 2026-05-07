"use client";

import { useState } from "react";
import { ChevronDown, Lock } from "lucide-react";

export function HowItWorks() {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02]">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <Lock size={14} className="text-accent" />
          <span className="text-sm font-medium text-white">
            How privacy works
          </span>
        </div>
        <ChevronDown
          size={16}
          className={`text-zinc-500 transition ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="space-y-3 border-t border-white/5 px-4 py-4 text-sm leading-relaxed text-zinc-400">
          <p>
            Your bid amount is encrypted in your browser using a shared secret
            derived from a fresh x25519 keypair and the MXE cluster's public
            key. Only the ciphertext is ever sent on-chain.
          </p>
          <p>
            When the auction ends, Arcium's MPC nodes jointly compute the
            winner without ever decrypting individual bids — they operate on
            secret shares. Only three values are revealed: the winner's index,
            the second-highest valid bid (the price the winner pays), and a
            flag that says a valid bid existed.
          </p>
          <p>
            Losing bid amounts are{" "}
            <span className="text-white">never</span> revealed, on-chain or
            off. Even the seller cannot see them.
          </p>
        </div>
      )}
    </div>
  );
}
