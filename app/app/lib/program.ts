"use client";

import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { useMemo } from "react";
import idl from "../../idl/vickreynftauction.json";
import type { Vickreynftauction } from "../../idl/vickreynftauction";

// Read-only provider used when no wallet is connected (e.g. browsing the
// home page). Anchor's Program only requires a provider for sendTransaction;
// fetches/coder work without a wallet.
function createReadOnlyProvider(connection: any): AnchorProvider {
  const dummyWallet = {
    publicKey: undefined as any,
    signTransaction: async () => {
      throw new Error("Read-only provider cannot sign");
    },
    signAllTransactions: async () => {
      throw new Error("Read-only provider cannot sign");
    },
  };
  return new AnchorProvider(connection, dummyWallet as any, {
    commitment: "confirmed",
  });
}

export function useVickreyProgram(): Program<Vickreynftauction> {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();

  return useMemo(() => {
    const provider = wallet
      ? new AnchorProvider(connection, wallet, { commitment: "confirmed" })
      : createReadOnlyProvider(connection);
    return new Program<Vickreynftauction>(idl as any, provider);
  }, [connection, wallet]);
}

export function useReadOnlyProgram(): Program<Vickreynftauction> {
  const { connection } = useConnection();
  return useMemo(() => {
    const provider = createReadOnlyProvider(connection);
    return new Program<Vickreynftauction>(idl as any, provider);
  }, [connection]);
}
