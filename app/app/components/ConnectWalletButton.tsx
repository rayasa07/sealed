"use client";

import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import { Wallet, ChevronDown, LogOut, Copy } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { truncateAddress } from "../lib/format";
import { toast } from "sonner";

export function ConnectWalletButton() {
  const { setVisible } = useWalletModal();
  const { publicKey, disconnect, connecting, wallet } = useWallet();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (!publicKey) {
    return (
      <button
        onClick={() => setVisible(true)}
        disabled={connecting}
        className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-accent/20 transition hover:bg-accent-hover disabled:opacity-60"
      >
        <Wallet size={16} />
        {connecting ? "Connecting..." : "Connect Wallet"}
      </button>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm font-medium text-white backdrop-blur transition hover:bg-white/10"
      >
        {wallet?.adapter.icon && (
          <img
            src={wallet.adapter.icon}
            alt=""
            width={16}
            height={16}
            className="rounded"
          />
        )}
        <span>{truncateAddress(publicKey)}</span>
        <ChevronDown size={14} className="opacity-60" />
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-white/10 bg-zinc-900 shadow-2xl">
          <button
            onClick={() => {
              navigator.clipboard.writeText(publicKey.toBase58());
              toast.success("Address copied");
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-zinc-200 hover:bg-white/5"
          >
            <Copy size={14} /> Copy address
          </button>
          <button
            onClick={() => {
              disconnect();
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-zinc-200 hover:bg-white/5"
          >
            <LogOut size={14} /> Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
