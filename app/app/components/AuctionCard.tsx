"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { fetchNftMetadata, placeholderImage } from "../lib/metadata";
import {
  formatSol,
  stateBadgeClass,
  stateToLabel,
  truncateAddress,
} from "../lib/format";
import { CountdownTimer } from "./CountdownTimer";
import type { AuctionWithKey } from "../lib/auction";
import { Users, Clock } from "lucide-react";

export function AuctionCard({ auction }: { auction: AuctionWithKey }) {
  const { connection } = useConnection();
  const [name, setName] = useState<string>(
    `NFT ${auction.account.nftMint.toBase58().slice(0, 4)}`
  );
  const [image, setImage] = useState<string>(
    placeholderImage(auction.account.nftMint.toBase58())
  );

  useEffect(() => {
    let cancelled = false;
    fetchNftMetadata(connection, auction.account.nftMint as PublicKey).then(
      (m) => {
        if (cancelled) return;
        if (m.name) setName(m.name);
        if (m.image) setImage(m.image);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [connection, auction.account.nftMint]);

  const stateLabel = stateToLabel(auction.account.state);
  const endTs = auction.account.endTs.toNumber();
  const settled = stateLabel === "Settled";

  return (
    <Link
      href={`/auction/${auction.publicKey.toBase58()}`}
      className="group relative overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02] transition hover:-translate-y-1 hover:border-accent/40 hover:bg-white/[0.04] hover:shadow-2xl hover:shadow-accent/10"
    >
      <div className="relative aspect-square w-full overflow-hidden bg-zinc-900">
        <Image
          src={image}
          alt={name}
          fill
          sizes="(max-width: 768px) 50vw, 25vw"
          className="object-cover transition duration-500 group-hover:scale-105"
          unoptimized
        />
        <div className="absolute left-3 top-3">
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${stateBadgeClass(stateLabel)}`}
          >
            {stateLabel}
          </span>
        </div>
      </div>
      <div className="space-y-2.5 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-1 font-semibold text-white">{name}</h3>
        </div>
        <p className="text-xs text-zinc-500">
          by {truncateAddress(auction.account.seller as PublicKey)}
        </p>
        <div className="flex items-center justify-between border-t border-white/5 pt-2.5 text-xs text-zinc-400">
          <span className="inline-flex items-center gap-1.5">
            <Users size={12} />
            {auction.account.bidCount}/8 bids
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock size={12} />
            {settled ? (
              `Sold for ${formatSol(auction.account.secondPrice, 2)}`
            ) : (
              <CountdownTimer endTs={endTs} />
            )}
          </span>
        </div>
      </div>
    </Link>
  );
}
