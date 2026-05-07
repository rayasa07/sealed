# Sealed — Vickrey NFT Auctions on Solana × Arcium MPC

> **Live:** https://sealed-rayasa07s-projects.vercel.app · **Network:** Solana Devnet

---

## What is Sealed?

Sealed is a trustless, privacy-preserving NFT auction protocol built on Solana, powered by Arcium's Multi-Party Computation (MPC) network. It implements a **Vickrey (sealed-bid second-price) auction**: the highest bidder wins, but pays only the second-highest bid price. Bid amounts are encrypted client-side using the Arcium MXE public key before ever touching the blockchain — no one, including the auction creator, can see individual bids until the winner is decided. Losing bids are **never revealed**.

---

## How It Works

1. **Create Auction** — Seller escrows a Metaplex NFT into the on-chain auction PDA and sets the auction window (`start_ts`, `end_ts`)
2. **Place Sealed Bid** — Each bidder publicly locks `max_collateral` SOL on-chain and submits an encrypted bid amount, encrypted client-side using x25519 Diffie-Hellman key exchange + RescueCipher (Arcium's ZK-friendly cipher) against the real MXE public key fetched from devnet
3. **Encrypted Commitment** — The two ciphertexts (bid amount + active flag) are stored in the bidder's `BidderRecord` PDA on Solana devnet, referencing the deployed Sealed MXE program ID
4. **Resolve Auction** — After `end_ts`, anyone can trigger the Arcium MPC `find_winner` circuit, which scans all encrypted bids, enforces `bid_amount ≤ max_collateral` per slot, and computes both the highest bidder index and the second-highest price — all without revealing individual bid values. Only the winner index, second price, and validity flag are decrypted on-chain.
5. **Settle** — Winner receives the NFT, seller is paid the second-highest price, the winner's excess collateral is refunded, and losing bidders permissionlessly reclaim their full collateral

---

## Real Arcium Integration

| Component | Details |
|---|---|
| **MXE Program** | `6K6aykKN8vrBg8RQDtpeJXm6KUo5hG3KFYfyWdi5YS1e` |
| **MXE Account** | `7t2Z6MBuWKfTWaUtHNj5LRwcuDbMJdvQ2ujNjUZa84SR` |
| **Comp Def Account** | `EumEzPVoJwdWvM9f2Pmm568SFPGsRBQtNNmTU9SXK4hi` |
| **Cluster Offset** | `456` (Arcium devnet cluster) |
| **Encryption** | x25519 key exchange + RescueCipher via `@arcium-hq/client` SDK |
| **MPC Circuit** | `find_winner` (compiled `.arcis` circuit, single computation per auction) |
| **Network** | Solana Devnet |

---

## MXE Program Features

- **`create_auction`** — Validates the Metaplex NFT (supply 1, decimals 0, rejects programmable NFTs), escrows it into the auction PDA, and stores the auction config
- **`submit_bid`** — Stores the bidder's encrypted bid ciphertexts in their lazy `BidderRecord` PDA and locks `max_collateral` SOL on-chain
- **`init_find_winner_comp_def`** — One-time setup that registers the `find_winner` MPC computation definition with the Arcium program- **`queue_find_winner`** — Builds an `ArgBuilder` payload of up to 8 encrypted bids + 8 public collaterals (sentinel-padded) and queues the MPC computation- **`find_winner_callback`** — Receives `SignedComputationOutputs<FindWinnerOutput>`, verifies the BLS-signed result, and stores `winner_index`, `second_price`, `has_valid_winner` on-chain- **`settle_auction`** — Permissionless. Transfers the NFT to the winner, pays the seller the second-highest price, and refunds the winner's excess collateral- **`refund_loser`** — Permissionless. Each losing bidder reclaims their full collateral- **`emergency_refund` / `emergency_reclaim_nft`** — Recovery path if the MPC computation fails or times out past `end_ts + EMERGENCY_TIMEOUT`

---

## Tech Stack

- **Frontend:** Next.js 14, TypeScript, Tailwind CSS
- **Blockchain:** Solana Web3.js, Wallet Adapter (Phantom)
- **MPC:** Arcium SDK (`@arcium-hq/client` 0.9.3), Anchor 0.32.1
- **Program:** Rust + `arcium-anchor` macros
- **Encrypted Circuit:** Rust + `arcis` framework (compiled to `.arcis` MPC bytecode)
- **Deployment:** Vercel (frontend), Solana Devnet (program)

---

## Project Structure
```
sealed/
├── app/                         # Next.js frontend (App Router)
│   ├── auction/[address]/       # Auction detail page (bid + settle UI)
│   ├── create/                  # Create auction page
│   ├── components/              # WalletProvider, AuctionCard, BidForm, etc.
│   ├── lib/                     # PDA helpers, Arcium encryption, program hooks
│   └── idl/                     # Anchor IDL for the deployed program
├── programs/
│   └── vickreynftauction/
│       ├── src/lib.rs           # Anchor program (9 on-chain instructions)
│       └── Cargo.toml
├── encrypted-ixs/
│   └── src/lib.rs               # Arcis MPC circuit (find_winner Vickrey logic)
├── tests/
│   ├── vickreynftauction.ts     # Localnet end-to-end test
│   └── vickreynftauction_devnet.ts # Devnet end-to-end test (verified passing)
├── scripts/
│   ├── init_devnet_comp_def.ts  # One-time devnet circuit upload script
│   └── mint-nft.ts              # Test NFT minting helper
├── devnet_e2e_proof.txt         # Captured output proving devnet flow works end-to-end
├── Anchor.toml
└── Arcium.toml
```

---

## Running Locally

```bash
git clone https://github.com/rayasa07/sealed
cd sealed
yarn install
arcium build
arcium test
```

Then start the frontend:

```bash
cd app
yarn install
yarn dev
```

Open http://localhost:3000 and connect a Phantom wallet on Solana Devnet.

---

## Deployed Program

The Sealed MXE program is deployed and verified on Solana Devnet:

- [View Program on Solana Explorer](https://explorer.solana.com/address/6K6aykKN8vrBg8RQDtpeJXm6KUo5hG3KFYfyWdi5YS1e?cluster=devnet)
- [View MXE Account](https://explorer.solana.com/address/7t2Z6MBuWKfTWaUtHNj5LRwcuDbMJdvQ2ujNjUZa84SR?cluster=devnet)

A captured end-to-end test run against real Arcium devnet MPC nodes is preserved in `devnet_e2e_proof.txt` — proving the Vickrey settlement (`winner_index=1`, `second_price=3 SOL`) was computed entirely inside the MPC network without revealing individual bids.

---

## Team

Built for the Arcium RTG by asa ray
