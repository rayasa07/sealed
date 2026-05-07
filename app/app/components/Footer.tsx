import Link from "next/link";
import { Lock } from "lucide-react";

export function Footer() {
  return (
    <footer className="mt-24 border-t border-white/5 bg-zinc-950">
      <div className="mx-auto grid max-w-7xl gap-8 px-6 py-12 md:grid-cols-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-purple-700">
              <Lock size={16} className="text-white" />
            </div>
            <span className="text-lg font-semibold text-white">Sealed</span>
          </div>
          <p className="mt-3 max-w-xs text-sm text-zinc-500">
            Private NFT auctions on Solana. Sealed bids stay encrypted, even
            from the seller.
          </p>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-white">Product</h4>
          <ul className="mt-3 space-y-2 text-sm text-zinc-500">
            <li>
              <Link href="/" className="hover:text-white">
                Browse auctions
              </Link>
            </li>
            <li>
              <Link href="/create" className="hover:text-white">
                Create auction
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-white">Powered by</h4>
          <ul className="mt-3 space-y-2 text-sm text-zinc-500">
            <li>
              <a
                href="https://arcium.com"
                target="_blank"
                rel="noreferrer"
                className="hover:text-white"
              >
                Arcium MPC network
              </a>
            </li>
            <li>
              <a
                href="https://solana.com"
                target="_blank"
                rel="noreferrer"
                className="hover:text-white"
              >
                Solana
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/5">
        <div className="mx-auto max-w-7xl px-6 py-6 text-xs text-zinc-600">
          Sealed is an experimental devnet deployment. Bids are real, but the
          tokens aren't.
        </div>
      </div>
    </footer>
  );
}
