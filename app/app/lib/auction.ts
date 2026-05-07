"use client";

import { useEffect, useRef, useState } from "react";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { useReadOnlyProgram, useVickreyProgram } from "./program";
import {
  AUCTION_CONFIG_DISCRIMINATOR,
  BIDDER_RECORD_DISCRIMINATOR,
  PROGRAM_ID,
} from "./constants";
import type { Vickreynftauction } from "../../idl/vickreynftauction";
import { bidderRecordPda } from "./pdas";

export type AuctionAccount = Awaited<
  ReturnType<Program<Vickreynftauction>["account"]["auctionConfig"]["fetch"]>
>;
export type BidderRecordAccount = Awaited<
  ReturnType<Program<Vickreynftauction>["account"]["bidderRecord"]["fetch"]>
>;

export type AuctionWithKey = {
  publicKey: PublicKey;
  account: AuctionAccount;
};

export type BidderRecordWithKey = {
  publicKey: PublicKey;
  account: BidderRecordAccount;
};

/**
 * List every AuctionConfig owned by the program. Filters by the 8-byte
 * Anchor discriminator so we never accidentally decode a different account
 * type that happens to match on size.
 */
export function useAuctions() {
  const { connection } = useConnection();
  const program = useReadOnlyProgram();
  const [data, setData] = useState<AuctionWithKey[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
          filters: [
            {
              memcmp: {
                offset: 0,
                bytes: bs58Encode(AUCTION_CONFIG_DISCRIMINATOR),
              },
            },
          ],
        });

        const decoded: AuctionWithKey[] = [];
        for (const { pubkey, account } of accounts) {
          try {
            const acc = program.coder.accounts.decode<AuctionAccount>(
              "auctionConfig",
              account.data
            );
            decoded.push({ publicKey: pubkey, account: acc });
          } catch {
            // skip undecodable accounts
          }
        }

        // Sort: active first (state=Active), then by start_ts descending.
        decoded.sort((a, b) => {
          const aActive = "active" in (a.account.state as any) ? 1 : 0;
          const bActive = "active" in (b.account.state as any) ? 1 : 0;
          if (aActive !== bActive) return bActive - aActive;
          return b.account.startTs.toNumber() - a.account.startTs.toNumber();
        });

        if (!cancelled) {
          setData(decoded);
          setLoading(false);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || String(err));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connection, program]);

  return { auctions: data, loading, error };
}

/**
 * Fetch a single auction and subscribe to live updates. Used by the auction
 * detail page to react to MPC callbacks the moment they land.
 */
export function useAuction(address: PublicKey | null) {
  const { connection } = useConnection();
  const program = useVickreyProgram();
  const [data, setData] = useState<AuctionAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const subId = useRef<number | null>(null);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const acc = await program.account.auctionConfig.fetch(address);
        if (!cancelled) {
          setData(acc);
          setLoading(false);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || String(err));
          setLoading(false);
        }
      }
    })();

    subId.current = connection.onAccountChange(
      address,
      (info) => {
        try {
          const decoded = program.coder.accounts.decode<AuctionAccount>(
            "auctionConfig",
            info.data
          );
          setData(decoded);
        } catch {
          // ignore decode errors during transitional states
        }
      },
      "confirmed"
    );

    return () => {
      cancelled = true;
      if (subId.current !== null) {
        connection.removeAccountChangeListener(subId.current);
        subId.current = null;
      }
    };
  }, [connection, program, address?.toBase58()]); // eslint-disable-line react-hooks/exhaustive-deps

  return { auction: data, loading, error };
}

/**
 * List every BidderRecord for a given auction. Used to populate the
 * remainingAccounts on queue_find_winner and to render the bidder list.
 */
export function useBidderRecords(auction: PublicKey | null) {
  const { connection } = useConnection();
  const program = useReadOnlyProgram();
  const [records, setRecords] = useState<BidderRecordWithKey[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!auction) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
          filters: [
            {
              memcmp: {
                offset: 0,
                bytes: bs58Encode(BIDDER_RECORD_DISCRIMINATOR),
              },
            },
            {
              memcmp: {
                offset: 8, // auction_config field starts right after discriminator
                bytes: auction.toBase58(),
              },
            },
          ],
        });

        const decoded: BidderRecordWithKey[] = [];
        for (const { pubkey, account } of accounts) {
          try {
            const acc = program.coder.accounts.decode<BidderRecordAccount>(
              "bidderRecord",
              account.data
            );
            decoded.push({ publicKey: pubkey, account: acc });
          } catch {
            // skip
          }
        }
        decoded.sort(
          (a, b) => a.account.bidderIndex - b.account.bidderIndex
        );
        if (!cancelled) {
          setRecords(decoded);
          setLoading(false);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || String(err));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connection, program, auction?.toBase58(), refreshKey]); // eslint-disable-line

  return {
    records,
    loading,
    error,
    refresh: () => setRefreshKey((k) => k + 1),
  };
}

export function useMyBidderRecord(
  auction: PublicKey | null,
  wallet: PublicKey | null
) {
  const program = useReadOnlyProgram();
  const { connection } = useConnection();
  const [record, setRecord] = useState<BidderRecordAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!auction || !wallet) {
      setRecord(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const pda = bidderRecordPda(auction, wallet);
    (async () => {
      try {
        const acc = await program.account.bidderRecord.fetch(pda);
        if (!cancelled) {
          setRecord(acc);
        }
      } catch {
        if (!cancelled) setRecord(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    connection,
    program,
    auction?.toBase58(),
    wallet?.toBase58(),
    refreshKey,
  ]); // eslint-disable-line

  return { record, loading, refresh: () => setRefreshKey((k) => k + 1) };
}

/* ------------------------------------------------------------------ */
/* Lightweight base58 encoder so we don't pull bs58 just for memcmp.   */
/* ------------------------------------------------------------------ */
const ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function bs58Encode(buffer: Uint8Array | Buffer): string {
  if (buffer.length === 0) return "";
  const digits = [0];
  for (let i = 0; i < buffer.length; i++) {
    let carry = buffer[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let result = "";
  for (let i = 0; i < buffer.length && buffer[i] === 0; i++) result += "1";
  for (let i = digits.length - 1; i >= 0; i--) result += ALPHABET[digits[i]];
  return result;
}
