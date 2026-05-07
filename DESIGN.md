## On-chain accounts (PDAs)

### AuctionConfig

**Seeds:** `["auction", seller, nft_mint]`

**Fields:**
- `seller`
- `nft_mint`
- `nft_escrow_token_account`
- `seller_receive_sol_account`
- `start_ts`
- `end_ts`
- `bid_count`
- `state`
- `winner_bidder_index`
- `second_price`
- `has_valid_winner`
- `winner_computed`
- `settled`
- `find_winner_comp_def`
- `latest_computation_id`
- `bump`

**Purpose:** Main auction state. Tracks NFT escrow, timing, bidder count, Arcium computation metadata, and final public settlement outputs.

### BidderRecord

**Seeds:** `["bidder", auction_config, bidder]`

**Fields:**
- `auction_config`
- `bidder`
- `bidder_index`
- `encrypted_bid_ciphertext: [u8; 32]`
- `encrypted_bid_pubkey: [u8; 32]`
- `encrypted_bid_nonce: u128`
- `max_collateral: u64`
- `has_submitted_bid`
- `refunded`
- `is_winner`
- `bump`

**Purpose:** Lazily created per bidder on `submit_bid`. Stores one encrypted bid and the public SOL collateral upper bound used by MPC validation.

### Auction SOL Escrow

**Seeds:** `["sol_escrow", auction_config]`

**Fields:** Native SOL lamports only.

**Purpose:** Holds bidder collateral until settlement, loser refund, or emergency refund.

### NFT Escrow Authority

**Seeds:** `["nft_authority", auction_config]`

**Fields:** PDA authority only.

**Purpose:** Owns/signs for the NFT escrow token account while the auction is active.

## Encrypted data structures (in the Arcis circuit)

### BidEntry

Fields:
- `amount: u64`
- `active: bool`

Purpose: Represents a sealed bid input. `active = false` marks an empty slot or invalid bid.

### MPC Bid Inputs

Type:
- `bids: [Enc<Mxe, BidEntry>; 8]`

Purpose: Fixed-size encrypted bid inputs. Each bid is encrypted off-chain by the bidder using the MXE x25519 public key, so only MPC nodes can decrypt during computation.

### Public Collateral Inputs

Type:
- `max_collaterals: [u64; 8]`

Purpose: Public collateral upper bounds, one per bid slot. The MPC circuit treats any slot with `amount > max_collateral` as inactive.

### MPC Outputs

Plaintext revealed outputs:
- `winner_index: u8`
- `second_price: u64`
- `has_valid_winner: bool`

Purpose: Minimal public result needed for settlement. No losing bid amounts are revealed.

## MPC circuit functions

### find_winner

**Inputs:**
- `bids: [Enc<Mxe, BidEntry>; 8]`
- `max_collaterals: [u64; 8]`

**Outputs:**
- `winner_index: u8`
- `second_price: u64`
- `has_valid_winner: bool`

**Computes:**
- Scans all 8 fixed slots.
- For each slot, computes effective validity as `bid.active && bid.amount <= max_collaterals[i]`.
- Treats inactive slots and bids exceeding collateral as invalid.
- Finds the highest valid bid and second-highest valid bid.
- Uses conditional-assignment patterns for secret-dependent comparisons.
- Uses no `Vec`, `match`, `while`, early return, or `break`.
- If exactly one valid bid exists, that bidder wins and pays their own bid amount.
- Reveals only winner index, second price, and valid-winner flag.
- Output fits within the Arcium signed output size limit.
- On-chain callback accepts result only through `SignedComputationOutputs<T>` plus `verify_output()`.

## Solana instructions (on-chain handlers)

### create_auction

**Signs:** Seller

**Accounts:**
- Seller
- `AuctionConfig`
- NFT mint
- NFT metadata account
- Seller NFT token account
- NFT escrow token account
- NFT escrow authority PDA
- System program
- Token program
- Associated token program

**Does:**
- Creates `AuctionConfig`.
- Validates NFT mint supply is `1`.
- Validates NFT mint decimals are `0`.
- Validates Metaplex Token Metadata account.
- Rejects programmable NFTs by checking metadata `token_standard`.
- Transfers NFT from seller into escrow.
- Stores auction timing and config.
- Sets auction state active.

### submit_bid

**Signs:** Bidder

**Accounts:**
- Bidder
- `AuctionConfig`
- `BidderRecord`
- Auction SOL escrow PDA
- System program

**Does:**
- Validates auction is active and within bidding window.
- Validates fewer than 8 bidders have submitted.
- Creates bidder’s lazy `BidderRecord`.
- Enforces one bid per wallet.
- Assigns fixed `bidder_index`.
- Stores `encrypted_bid_ciphertext`, `encrypted_bid_pubkey`, and `encrypted_bid_nonce`.
- Stores public `max_collateral`.
- Transfers `max_collateral` lamports from bidder into auction SOL escrow.
- Increments `bid_count`.

### init_find_winner_comp_def

**Signs:** Seller or auction authority

**Accounts:**
- `AuctionConfig`
- Arcium program accounts
- `ArciumSignerAccount`
- Payer

**Does:**
- Initializes the single Arcium computation definition for `find_winner`.
- Stores the computation definition reference in `AuctionConfig`.

### queue_find_winner

**Signs:** Seller or permissionless caller after auction end

**Accounts:**
- `AuctionConfig`
- Up to 8 `BidderRecord` accounts
- Arcium queue accounts
- `ArciumSignerAccount`

**Does:**
- Validates auction end time has passed.
- Builds fixed-size `bids: [Enc<Mxe, BidEntry>; 8]` from bidder records.
- Builds fixed-size `max_collaterals: [u64; 8]`.
- Fills unused slots with sentinel encrypted `BidEntry { amount: 0, active: false }` and `max_collateral = 0`.
- Queues the single `find_winner` MPC computation.
- Stores latest computation id.
- Moves auction state to computation pending.

### callback_find_winner

**Signs:** Arcium callback authority / verified Arcium flow

**Accounts:**
- `AuctionConfig`
- Arcium output accounts

**Does:**
- Receives `SignedComputationOutputs<WinnerResult>`.
- Calls `verify_output()`.
- Stores `winner_index`, `second_price`, and `has_valid_winner`.
- Marks `winner_computed = true`.
- Moves auction state to winner computed if verification succeeds.
- Moves auction state to computation failed if verification or output handling fails.

### settle_auction

**Signs:** Permissionless caller

**Accounts:**
- `AuctionConfig`
- Winner `BidderRecord`
- Winner wallet
- Seller SOL receive account
- Auction SOL escrow PDA
- NFT escrow token account
- Winner NFT token account
- NFT escrow authority PDA
- Token program
- System program

**Does:**
- Validates `callback_find_winner` succeeded.
- Validates `has_valid_winner = true`.
- Validates auction is not settled.
- Transfers NFT from escrow to winner.
- Transfers `second_price` lamports from SOL escrow to seller.
- Refunds winner excess collateral: `max_collateral - second_price`.
- Marks winner record as winner and refunded.
- Marks auction settled.

### refund_loser

**Signs:** Losing bidder or permissionless caller

**Accounts:**
- `AuctionConfig`
- Losing `BidderRecord`
- Losing bidder wallet
- Auction SOL escrow PDA
- System program

**Does:**
- Validates winner has been computed.
- Validates auction is settled or settlement is otherwise finalized.
- Validates bidder is not the winner.
- Refunds full `max_collateral`.
- Marks bidder as refunded.

### emergency_refund

**Signs:** Bidder

**Accounts:**
- `AuctionConfig`
- Bidder `BidderRecord`
- Bidder wallet
- Auction SOL escrow PDA
- System program

**Does:**
- Callable if `auction.state == ComputationFailed`, or if `block_time > end_ts + EMERGENCY_TIMEOUT` and winner has not been computed.
- Refunds bidder’s full `max_collateral`.
- Marks bidder as refunded.
- Prevents double refund.

### emergency_reclaim_nft

**Signs:** Seller

**Accounts:**
- Seller
- `AuctionConfig`
- NFT escrow token account
- Seller NFT token account
- NFT escrow authority PDA
- Token program

**Does:**
- Callable in the same emergency state as `emergency_refund`.
- Returns escrowed NFT to seller.
- Marks auction as emergency closed or cancelled.
- Does not affect bidders’ ability to claim emergency refunds.

## End-to-end user flow

1. Seller creates the auction and escrows the Metaplex classic NFT into the auction NFT escrow account.

2. Program validates the NFT mint has supply `1`, decimals `0`, valid Token Metadata, and is not programmable.

3. Seller or auction authority initializes the single Arcium computation definition for `find_winner`.

4. Bidder encrypts `BidEntry { amount, active: true }` off-chain using the MXE x25519 public key.

5. Bidder submits one final bid by creating a `BidderRecord`, storing encrypted bid data, and locking public `max_collateral` SOL.

6. More bidders submit until the auction reaches 8 bidders or the bidding window ends.

7. After `end_ts`, any permitted caller queues `find_winner`.

8. The program gathers up to 8 bidder records, fills unused slots with encrypted sentinel inactive bids, builds public `max_collaterals`, and queues the MPC computation.

9. Arcium decrypts bids inside MPC only, enforces `amount <= max_collateral`, ignores invalid bids, and computes the highest valid bidder plus the second price.

10. Arcium returns signed plaintext outputs: `winner_index`, `second_price`, and `has_valid_winner`.

11. `callback_find_winner` verifies the result with `verify_output()` and stores the final auction result.

12. After successful callback, settlement is permissionless.

13. `settle_auction` transfers the NFT to the winner, pays the seller `second_price`, and refunds the winner’s excess collateral.

14. Each losing bidder calls `refund_loser` to reclaim their full `max_collateral`.

15. If computation fails or times out past `end_ts + EMERGENCY_TIMEOUT` before winner computation, bidders call `emergency_refund` and seller calls `emergency_reclaim_nft`.

## Locked Decisions

- No reserve price in v1.

- Single MPC computation per auction: `find_winner` only.

- No separate `EncryptedBidsState` PDA.

- No shared encrypted bid array is stored on-chain.

- Each bidder’s encrypted bid is stored in their own lazy `BidderRecord` PDA.

- Maximum 8 bidders per auction.

- Empty bidder slots are filled before MPC with sentinel encrypted `BidEntry { amount: 0, active: false }`.

- Bids are stored as `Enc<Mxe, BidEntry>`, encrypted using the MXE x25519 public key.

- Public collateral is `max_collateral`, not necessarily the exact bid.

- The MPC circuit enforces `bid_amount <= max_collateral`.

- Bids exceeding collateral are treated as inactive.

- If only one valid bid exists, that bidder wins and pays their own bid amount, represented by their `max_collateral`.

- One bid per wallet.

- Bids are final: no top-ups, no replacements.

- Settlement is permissionless after `callback_find_winner` succeeds.

- Each loser claims their own refund through `refund_loser`.

- NFT validation checks mint supply `1`, decimals `0`, and rejects programmable NFTs via metadata `token_standard`.

- Emergency refunds are available if computation fails or times out after `end_ts + EMERGENCY_TIMEOUT` before winner computation.

- Seller can reclaim the NFT in the emergency state.

- Bidder records are created lazily on `submit_bid`.

- On-chain Arcium integration uses `arcis`, `ArciumSignerAccount`, `SignedComputationOutputs<T>`, and `verify_output()`.
