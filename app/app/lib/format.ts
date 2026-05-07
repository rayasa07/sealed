import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import BN from "bn.js";

export function truncateAddress(addr: string | PublicKey, size = 4): string {
  const s = typeof addr === "string" ? addr : addr.toBase58();
  if (s.length <= size * 2 + 3) return s;
  return `${s.slice(0, size)}...${s.slice(-size)}`;
}

export function lamportsToSol(lamports: BN | number | bigint): number {
  if (typeof lamports === "number") return lamports / LAMPORTS_PER_SOL;
  if (typeof lamports === "bigint")
    return Number(lamports) / LAMPORTS_PER_SOL;
  return lamports.toNumber() / LAMPORTS_PER_SOL;
}

export function formatSol(
  lamports: BN | number | bigint,
  decimals = 4
): string {
  return `${lamportsToSol(lamports).toFixed(decimals)} SOL`;
}

export function solToLamports(sol: number): BN {
  return new BN(Math.round(sol * LAMPORTS_PER_SOL));
}

export function formatRemaining(seconds: number): string {
  if (seconds <= 0) return "Ended";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export type AuctionStateLabel =
  | "Active"
  | "Bidding Closed"
  | "Computation Pending"
  | "Winner Computed"
  | "Settled"
  | "Computation Failed"
  | "Emergency Closed"
  | "Unknown";

export function stateToLabel(state: any): AuctionStateLabel {
  if (!state) return "Unknown";
  if ("active" in state) return "Active";
  if ("biddingClosed" in state) return "Bidding Closed";
  if ("computationPending" in state) return "Computation Pending";
  if ("winnerComputed" in state) return "Winner Computed";
  if ("settled" in state) return "Settled";
  if ("computationFailed" in state) return "Computation Failed";
  if ("emergencyClosed" in state) return "Emergency Closed";
  return "Unknown";
}

export function stateBadgeClass(label: AuctionStateLabel): string {
  switch (label) {
    case "Active":
      return "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30";
    case "Bidding Closed":
      return "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30";
    case "Computation Pending":
      return "bg-purple-500/15 text-purple-300 ring-1 ring-purple-500/30";
    case "Winner Computed":
      return "bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/30";
    case "Settled":
      return "bg-zinc-500/15 text-zinc-300 ring-1 ring-zinc-500/30";
    case "Computation Failed":
    case "Emergency Closed":
      return "bg-red-500/15 text-red-300 ring-1 ring-red-500/30";
    default:
      return "bg-zinc-500/15 text-zinc-300 ring-1 ring-zinc-500/30";
  }
}
