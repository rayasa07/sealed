"use client";

import { PublicKey } from "@solana/web3.js";
import {
  getCompDefAccOffset,
  getMXEAccAddress,
  getMempoolAccAddress,
  getCompDefAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getClusterAccAddress,
  getFeePoolAccAddress,
  getClockAccAddress,
} from "@arcium-hq/client";
import BN from "bn.js";

const ARCIUM_CLUSTER_OFFSET = Number(
  process.env.NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET ?? 456
);

/**
 * Build the queue-computation account map exactly like
 * tests/vickreynftauction.ts. Centralized so the page-level call sites read
 * cleanly.
 */
export function arciumQueueAccounts(
  programId: PublicKey,
  computationOffset: BN,
  circuit: string
) {
  return {
    computationAccount: getComputationAccAddress(
      ARCIUM_CLUSTER_OFFSET,
      computationOffset
    ),
    clusterAccount: getClusterAccAddress(ARCIUM_CLUSTER_OFFSET),
    mxeAccount: getMXEAccAddress(programId),
    mempoolAccount: getMempoolAccAddress(ARCIUM_CLUSTER_OFFSET),
    executingPool: getExecutingPoolAccAddress(ARCIUM_CLUSTER_OFFSET),
    compDefAccount: getCompDefAccAddress(
      programId,
      Buffer.from(getCompDefAccOffset(circuit)).readUInt32LE()
    ),
    poolAccount: getFeePoolAccAddress(),
    clockAccount: getClockAccAddress(),
  };
}
