use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    metadata::{Metadata, MetadataAccount, mpl_token_metadata::types::TokenStandard},
    token::{self, Mint, Token, TokenAccount, Transfer},
};
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;
use arcium_macros::arcium_program;

declare_id!("6K6aykKN8vrBg8RQDtpeJXm6KUo5hG3KFYfyWdi5YS1e");

pub const MAX_BIDDERS: usize = 8;
pub const EMERGENCY_TIMEOUT_SECS: i64 = 86_400;

pub const AUCTION_SEED: &[u8] = b"auction";
pub const BIDDER_SEED: &[u8] = b"bidder";
pub const SOL_ESCROW_SEED: &[u8] = b"sol_escrow";
pub const NFT_AUTHORITY_SEED: &[u8] = b"nft_authority";

pub const COMP_DEF_OFFSET_FIND_WINNER: u32 = comp_def_offset("find_winner");

#[arcium_program]
pub mod vickreynftauction {
    use super::*;

    pub fn create_auction(ctx: Context<CreateAuction>, end_ts: i64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(end_ts > now, AuctionError::InvalidAuctionState);

        let mint = &ctx.accounts.nft_mint;
        require!(mint.supply == 1, AuctionError::InvalidNftMintSupply);
        require!(mint.decimals == 0, AuctionError::InvalidNftMintDecimals);

        if let Some(token_standard) = &ctx.accounts.nft_metadata.token_standard {
            require!(
                *token_standard != TokenStandard::ProgrammableNonFungible,
                AuctionError::ProgrammableNftNotSupported
            );
        }

        let cpi_accounts = Transfer {
            from: ctx.accounts.seller_nft_account.to_account_info(),
            to: ctx.accounts.nft_escrow_token_account.to_account_info(),
            authority: ctx.accounts.seller.to_account_info(),
        };
        token::transfer(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
            1,
        )?;

        let auction = &mut ctx.accounts.auction_config;
        auction.seller = ctx.accounts.seller.key();
        auction.nft_mint = ctx.accounts.nft_mint.key();
        auction.nft_escrow_token_account = ctx.accounts.nft_escrow_token_account.key();
        auction.start_ts = now;
        auction.end_ts = end_ts;
        auction.bid_count = 0;
        auction.state = AuctionState::Active;
        auction.winner_bidder_index = 0;
        auction.second_price = 0;
        auction.has_valid_winner = false;
        auction.winner_computed = false;
        auction.settled = false;
        auction.find_winner_comp_def = Pubkey::default();
        auction.bump = ctx.bumps.auction_config;

        Ok(())
    }

    pub fn submit_bid(
        ctx: Context<SubmitBid>,
        encrypted_bid_amount: [u8; 32],
        encrypted_bid_active: [u8; 32],
        encrypted_bid_pubkey: [u8; 32],
        encrypted_bid_nonce: u128,
        max_collateral: u64,
    ) -> Result<()> {
        let auction = &mut ctx.accounts.auction_config;
        require!(
            auction.state == AuctionState::Active,
            AuctionError::AuctionNotActive
        );
        require!(
            Clock::get()?.unix_timestamp < auction.end_ts,
            AuctionError::AuctionNotActive
        );
        require!(
            auction.bid_count < MAX_BIDDERS as u8,
            AuctionError::MaxBiddersReached
        );
        require!(max_collateral > 0, AuctionError::InvalidAuctionState);

        let cpi_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.bidder.to_account_info(),
                to: ctx.accounts.sol_escrow.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(cpi_ctx, max_collateral)?;

        let record = &mut ctx.accounts.bidder_record;
        record.auction_config = auction.key();
        record.bidder = ctx.accounts.bidder.key();
        record.bidder_index = auction.bid_count;
        record.encrypted_bid_amount = encrypted_bid_amount;
        record.encrypted_bid_active = encrypted_bid_active;
        record.encrypted_bid_pubkey = encrypted_bid_pubkey;
        record.encrypted_bid_nonce = encrypted_bid_nonce;
        record.max_collateral = max_collateral;
        record.has_submitted_bid = true;
        record.refunded = false;
        record.is_winner = false;
        record.bump = ctx.bumps.bidder_record;

        auction.bid_count += 1;

        Ok(())
    }

    pub fn init_find_winner_comp_def(ctx: Context<InitFindWinnerCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    pub fn queue_find_winner<'info>(
        ctx: Context<'_, '_, 'info, 'info, QueueFindWinner<'info>>,
        computation_offset: u64,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let auction_key = ctx.accounts.auction_config.key();
        let auction_end_ts = ctx.accounts.auction_config.end_ts;
        let auction_state = ctx.accounts.auction_config.state;
        let bid_count = ctx.accounts.auction_config.bid_count;

        require!(now >= auction_end_ts, AuctionError::AuctionStillActive);
        require!(
            auction_state == AuctionState::Active
                || auction_state == AuctionState::BiddingClosed,
            AuctionError::InvalidAuctionState
        );
        require!(bid_count > 0, AuctionError::InvalidAuctionState);
        require!(
            ctx.remaining_accounts.len() == bid_count as usize,
            AuctionError::InvalidAuctionState
        );

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        let mut collaterals = [0u64; MAX_BIDDERS];
        let mut builder = ArgBuilder::new();

        for i in 0..(bid_count as usize) {
            let acc_info = &ctx.remaining_accounts[i];
            require_keys_eq!(
                *acc_info.owner,
                *ctx.program_id,
                AuctionError::InvalidAuctionState
            );
            let record: Account<BidderRecord> = Account::try_from(acc_info)?;

            let (expected_pda, _) = Pubkey::find_program_address(
                &[BIDDER_SEED, auction_key.as_ref(), record.bidder.as_ref()],
                ctx.program_id,
            );
            require_keys_eq!(
                acc_info.key(),
                expected_pda,
                AuctionError::InvalidAuctionState
            );
            require_keys_eq!(
                record.auction_config,
                auction_key,
                AuctionError::InvalidAuctionState
            );
            require!(
                record.bidder_index == i as u8,
                AuctionError::InvalidAuctionState
            );

            builder = builder
                .x25519_pubkey(record.encrypted_bid_pubkey)
                .plaintext_u128(record.encrypted_bid_nonce)
                .encrypted_u64(record.encrypted_bid_amount)
                .encrypted_bool(record.encrypted_bid_active);
            collaterals[i] = record.max_collateral;
        }

        for _ in (bid_count as usize)..MAX_BIDDERS {
            builder = builder
                .x25519_pubkey([0u8; 32])
                .plaintext_u128(0)
                .encrypted_u64([0u8; 32])
                .encrypted_bool([0u8; 32]);
        }

        for c in collaterals.iter() {
            builder = builder.plaintext_u64(*c);
        }

        let args = builder.build();

        let callback_ix = FindWinnerCallback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            &[CallbackAccount {
                pubkey: auction_key,
                is_writable: true,
            }],
        )?;

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![callback_ix],
            1,
            0,
        )?;

        ctx.accounts.auction_config.state = AuctionState::ComputationPending;

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "find_winner")]
    pub fn find_winner_callback(
        ctx: Context<FindWinnerCallback>,
        _output: SignedComputationOutputs<FindWinnerOutput>,
    ) -> Result<()> {
        let output = _output;
        let result = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(FindWinnerOutput {
                field_0:
                    FindWinnerOutputStruct0 {
                        field_0,
                        field_1,
                        field_2,
                    },
            }) => (field_0, field_1, field_2),
            Err(e) => {
                msg!("find_winner verification failed: {}", e);
                let auction = &mut ctx.accounts.auction_config;
                auction.state = AuctionState::ComputationFailed;
                return Err(AuctionError::ComputationFailed.into());
            }
        };

        let (winner_index, second_price, has_valid_winner) = result;

        let auction = &mut ctx.accounts.auction_config;
        auction.winner_bidder_index = winner_index;
        auction.second_price = second_price;
        auction.has_valid_winner = has_valid_winner;
        auction.winner_computed = true;
        auction.state = AuctionState::WinnerComputed;

        Ok(())
    }

    pub fn settle_auction(ctx: Context<SettleAuction>) -> Result<()> {
        let auction = &ctx.accounts.auction_config;
        require!(
            auction.state == AuctionState::WinnerComputed,
            AuctionError::WinnerNotComputed
        );
        require!(auction.winner_computed, AuctionError::WinnerNotComputed);
        require!(!auction.settled, AuctionError::AlreadySettled);
        require!(auction.has_valid_winner, AuctionError::WinnerNotComputed);

        let winner_record = &ctx.accounts.winner_record;
        require!(
            winner_record.bidder_index == auction.winner_bidder_index,
            AuctionError::BidderIsNotWinner
        );
        require!(!winner_record.refunded, AuctionError::AlreadyRefunded);

        let second_price = auction.second_price;
        let excess = winner_record
            .max_collateral
            .checked_sub(second_price)
            .ok_or(AuctionError::InvalidAuctionState)?;

        let auction_key = ctx.accounts.auction_config.key();
        let escrow_signer_seeds = &[
            SOL_ESCROW_SEED,
            auction_key.as_ref(),
            &[ctx.bumps.sol_escrow],
        ];
        let escrow_signer = &[&escrow_signer_seeds[..]];
        let nft_authority_seeds = &[
            NFT_AUTHORITY_SEED,
            auction_key.as_ref(),
            &[ctx.bumps.nft_escrow_authority],
        ];
        let signer_seeds = &[&nft_authority_seeds[..]];
        let cpi_accounts = Transfer {
            from: ctx.accounts.nft_escrow_token_account.to_account_info(),
            to: ctx.accounts.winner_nft_account.to_account_info(),
            authority: ctx.accounts.nft_escrow_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer(cpi_ctx, 1)?;

        anchor_lang::system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.sol_escrow.to_account_info(),
                    to: ctx.accounts.seller.to_account_info(),
                },
                escrow_signer,
            ),
            second_price,
        )?;

        anchor_lang::system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.sol_escrow.to_account_info(),
                    to: ctx.accounts.winner.to_account_info(),
                },
                escrow_signer,
            ),
            excess,
        )?;

        let winner_record = &mut ctx.accounts.winner_record;
        winner_record.is_winner = true;
        winner_record.refunded = true;

        let auction = &mut ctx.accounts.auction_config;
        auction.settled = true;
        auction.state = AuctionState::Settled;

        Ok(())
    }

    pub fn refund_loser(ctx: Context<RefundLoser>) -> Result<()> {
        let auction = &ctx.accounts.auction_config;
        require!(auction.winner_computed, AuctionError::WinnerNotComputed);

        let bidder_record = &ctx.accounts.bidder_record;
        require!(!bidder_record.refunded, AuctionError::AlreadyRefunded);
        require!(
            bidder_record.bidder_index != auction.winner_bidder_index
                || !auction.has_valid_winner,
            AuctionError::BidderIsWinner
        );

        let amount = ctx.accounts.bidder_record.max_collateral;
        let auction_key = ctx.accounts.auction_config.key();
        let escrow_signer_seeds = &[
            SOL_ESCROW_SEED,
            auction_key.as_ref(),
            &[ctx.bumps.sol_escrow],
        ];
        let escrow_signer = &[&escrow_signer_seeds[..]];

        anchor_lang::system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.sol_escrow.to_account_info(),
                    to: ctx.accounts.bidder.to_account_info(),
                },
                escrow_signer,
            ),
            amount,
        )?;

        ctx.accounts.bidder_record.refunded = true;

        Ok(())
    }

    pub fn emergency_refund(ctx: Context<EmergencyRefund>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let auction = &ctx.accounts.auction_config;
        let timeout_passed = now > auction.end_ts.saturating_add(EMERGENCY_TIMEOUT_SECS);
        let is_emergency = auction.state == AuctionState::ComputationFailed
            || (timeout_passed && !auction.winner_computed);
        require!(is_emergency, AuctionError::EmergencyConditionsNotMet);

        let bidder_record = &ctx.accounts.bidder_record;
        require!(!bidder_record.refunded, AuctionError::AlreadyRefunded);

        let amount = ctx.accounts.bidder_record.max_collateral;
        let auction_key = ctx.accounts.auction_config.key();
        let escrow_signer_seeds = &[
            SOL_ESCROW_SEED,
            auction_key.as_ref(),
            &[ctx.bumps.sol_escrow],
        ];
        let escrow_signer = &[&escrow_signer_seeds[..]];

        anchor_lang::system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.sol_escrow.to_account_info(),
                    to: ctx.accounts.bidder.to_account_info(),
                },
                escrow_signer,
            ),
            amount,
        )?;

        ctx.accounts.bidder_record.refunded = true;

        let auction = &mut ctx.accounts.auction_config;
        if auction.state != AuctionState::EmergencyClosed {
            auction.state = AuctionState::EmergencyClosed;
        }

        Ok(())
    }

    pub fn emergency_reclaim_nft(ctx: Context<EmergencyReclaimNft>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let auction = &ctx.accounts.auction_config;
        let timeout_passed = now > auction.end_ts.saturating_add(EMERGENCY_TIMEOUT_SECS);
        let is_emergency = auction.state == AuctionState::ComputationFailed
            || (timeout_passed && !auction.winner_computed);
        require!(is_emergency, AuctionError::EmergencyConditionsNotMet);
        require!(!auction.settled, AuctionError::AlreadySettled);

        let auction_key = ctx.accounts.auction_config.key();
        let nft_authority_seeds = &[
            NFT_AUTHORITY_SEED,
            auction_key.as_ref(),
            &[ctx.bumps.nft_escrow_authority],
        ];
        let signer_seeds = &[&nft_authority_seeds[..]];
        let cpi_accounts = Transfer {
            from: ctx.accounts.nft_escrow_token_account.to_account_info(),
            to: ctx.accounts.seller_nft_account.to_account_info(),
            authority: ctx.accounts.nft_escrow_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer(cpi_ctx, 1)?;

        let auction = &mut ctx.accounts.auction_config;
        auction.state = AuctionState::EmergencyClosed;
        auction.settled = true;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct CreateAuction<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,

    pub nft_mint: Account<'info, Mint>,

    #[account(
        seeds = [
            b"metadata",
            Metadata::id().as_ref(),
            nft_mint.key().as_ref(),
        ],
        seeds::program = Metadata::id(),
        bump,
    )]
    pub nft_metadata: Account<'info, MetadataAccount>,

    #[account(
        mut,
        associated_token::mint = nft_mint,
        associated_token::authority = seller,
    )]
    pub seller_nft_account: Account<'info, TokenAccount>,

    /// CHECK: PDA, just an authority.
    #[account(
        seeds = [NFT_AUTHORITY_SEED, auction_config.key().as_ref()],
        bump,
    )]
    pub nft_escrow_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = seller,
        associated_token::mint = nft_mint,
        associated_token::authority = nft_escrow_authority,
    )]
    pub nft_escrow_token_account: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = seller,
        space = 8 + AuctionConfig::INIT_SPACE,
        seeds = [AUCTION_SEED, seller.key().as_ref(), nft_mint.key().as_ref()],
        bump,
    )]
    pub auction_config: Account<'info, AuctionConfig>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub metadata_program: Program<'info, Metadata>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SubmitBid<'info> {
    #[account(mut)]
    pub bidder: Signer<'info>,

    #[account(
        mut,
        seeds = [AUCTION_SEED, auction_config.seller.as_ref(), auction_config.nft_mint.as_ref()],
        bump = auction_config.bump,
    )]
    pub auction_config: Account<'info, AuctionConfig>,

    #[account(
        init,
        payer = bidder,
        space = 8 + BidderRecord::INIT_SPACE,
        seeds = [BIDDER_SEED, auction_config.key().as_ref(), bidder.key().as_ref()],
        bump,
    )]
    pub bidder_record: Account<'info, BidderRecord>,

    /// CHECK: PDA used as a SOL-only escrow. Owned by System Program. We only deposit lamports here.
    #[account(
        mut,
        seeds = [SOL_ESCROW_SEED, auction_config.key().as_ref()],
        bump,
    )]
    pub sol_escrow: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("find_winner", payer)]
#[derive(Accounts)]
pub struct InitFindWinnerCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Box<Account<'info, MXEAccount>>,

    #[account(mut)]
    /// CHECK: Created by Arcium init_comp_def. Validated by the Arcium program.
    pub comp_def_account: UncheckedAccount<'info>,

    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: PDA derived from the MXE account LUT slot and constrained by address.
    pub address_lookup_table: UncheckedAccount<'info>,

    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: Address is constrained to the canonical LUT program id.
    pub lut_program: UncheckedAccount<'info>,

    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[queue_computation_accounts("find_winner", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct QueueFindWinner<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [AUCTION_SEED, auction_config.seller.as_ref(), auction_config.nft_mint.as_ref()],
        bump = auction_config.bump,
    )]
    pub auction_config: Account<'info, AuctionConfig>,

    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,

    /// CHECK: PDA derived and validated by Arcium.
    #[account(mut, address = derive_mempool_pda!(mxe_account, AuctionError::InvalidAuctionState))]
    pub mempool_account: UncheckedAccount<'info>,

    /// CHECK: PDA derived and validated by Arcium.
    #[account(mut, address = derive_execpool_pda!(mxe_account, AuctionError::InvalidAuctionState))]
    pub executing_pool: UncheckedAccount<'info>,

    /// CHECK: PDA derived and validated by Arcium.
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, AuctionError::InvalidAuctionState))]
    pub computation_account: UncheckedAccount<'info>,

    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_FIND_WINNER))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,

    #[account(mut, address = derive_cluster_pda!(mxe_account, AuctionError::InvalidAuctionState))]
    pub cluster_account: Box<Account<'info, Cluster>>,

    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,

    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,

    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("find_winner")]
#[derive(Accounts)]
pub struct FindWinnerCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,

    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_FIND_WINNER))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,

    /// CHECK: Validated by the Arcium program before callback dispatch.
    pub computation_account: UncheckedAccount<'info>,

    #[account(address = derive_cluster_pda!(mxe_account, AuctionError::InvalidAuctionState))]
    pub cluster_account: Box<Account<'info, Cluster>>,

    /// CHECK: Sysvar address constraint.
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions_sysvar: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [AUCTION_SEED, auction_config.seller.as_ref(), auction_config.nft_mint.as_ref()],
        bump = auction_config.bump,
    )]
    pub auction_config: Account<'info, AuctionConfig>,
}

#[derive(Accounts)]
pub struct SettleAuction<'info> {
    /// CHECK: Permissionless caller. Pays only tx fees.
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [AUCTION_SEED, auction_config.seller.as_ref(), auction_config.nft_mint.as_ref()],
        bump = auction_config.bump,
    )]
    pub auction_config: Account<'info, AuctionConfig>,

    #[account(
        mut,
        seeds = [BIDDER_SEED, auction_config.key().as_ref(), winner.key().as_ref()],
        bump = winner_record.bump,
        constraint = winner_record.auction_config == auction_config.key() @ AuctionError::BidderIsNotWinner,
    )]
    pub winner_record: Account<'info, BidderRecord>,

    /// CHECK: Winner wallet, receives NFT and excess SOL refund. Validated against winner_record.bidder.
    #[account(
        mut,
        constraint = winner.key() == winner_record.bidder @ AuctionError::BidderIsNotWinner,
    )]
    pub winner: UncheckedAccount<'info>,

    /// CHECK: Seller wallet, receives second_price. Validated against auction_config.seller.
    #[account(
        mut,
        constraint = seller.key() == auction_config.seller @ AuctionError::InvalidAuctionState,
    )]
    pub seller: UncheckedAccount<'info>,

    /// CHECK: SOL escrow PDA.
    #[account(
        mut,
        seeds = [SOL_ESCROW_SEED, auction_config.key().as_ref()],
        bump,
    )]
    pub sol_escrow: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = nft_escrow_token_account.key() == auction_config.nft_escrow_token_account @ AuctionError::InvalidAuctionState,
    )]
    pub nft_escrow_token_account: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = nft_mint,
        associated_token::authority = winner,
    )]
    pub winner_nft_account: Account<'info, TokenAccount>,

    #[account(
        constraint = nft_mint.key() == auction_config.nft_mint @ AuctionError::InvalidAuctionState,
    )]
    pub nft_mint: Account<'info, Mint>,

    /// CHECK: NFT escrow authority PDA.
    #[account(
        seeds = [NFT_AUTHORITY_SEED, auction_config.key().as_ref()],
        bump,
    )]
    pub nft_escrow_authority: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RefundLoser<'info> {
    /// CHECK: Permissionless caller. Pays only tx fees.
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        seeds = [AUCTION_SEED, auction_config.seller.as_ref(), auction_config.nft_mint.as_ref()],
        bump = auction_config.bump,
    )]
    pub auction_config: Account<'info, AuctionConfig>,

    #[account(
        mut,
        seeds = [BIDDER_SEED, auction_config.key().as_ref(), bidder.key().as_ref()],
        bump = bidder_record.bump,
        constraint = bidder_record.auction_config == auction_config.key() @ AuctionError::InvalidAuctionState,
    )]
    pub bidder_record: Account<'info, BidderRecord>,

    /// CHECK: Bidder wallet receiving refund. Validated against bidder_record.bidder.
    #[account(
        mut,
        constraint = bidder.key() == bidder_record.bidder @ AuctionError::InvalidAuctionState,
    )]
    pub bidder: UncheckedAccount<'info>,

    /// CHECK: SOL escrow PDA.
    #[account(
        mut,
        seeds = [SOL_ESCROW_SEED, auction_config.key().as_ref()],
        bump,
    )]
    pub sol_escrow: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EmergencyRefund<'info> {
    #[account(mut)]
    pub bidder: Signer<'info>,

    #[account(
        mut,
        seeds = [AUCTION_SEED, auction_config.seller.as_ref(), auction_config.nft_mint.as_ref()],
        bump = auction_config.bump,
    )]
    pub auction_config: Account<'info, AuctionConfig>,

    #[account(
        mut,
        seeds = [BIDDER_SEED, auction_config.key().as_ref(), bidder.key().as_ref()],
        bump = bidder_record.bump,
        constraint = bidder_record.auction_config == auction_config.key() @ AuctionError::InvalidAuctionState,
        constraint = bidder_record.bidder == bidder.key() @ AuctionError::InvalidAuctionState,
    )]
    pub bidder_record: Account<'info, BidderRecord>,

    /// CHECK: SOL escrow PDA.
    #[account(
        mut,
        seeds = [SOL_ESCROW_SEED, auction_config.key().as_ref()],
        bump,
    )]
    pub sol_escrow: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EmergencyReclaimNft<'info> {
    #[account(
        mut,
        constraint = seller.key() == auction_config.seller @ AuctionError::InvalidAuctionState,
    )]
    pub seller: Signer<'info>,

    #[account(
        mut,
        seeds = [AUCTION_SEED, auction_config.seller.as_ref(), auction_config.nft_mint.as_ref()],
        bump = auction_config.bump,
    )]
    pub auction_config: Account<'info, AuctionConfig>,

    #[account(
        mut,
        constraint = nft_escrow_token_account.key() == auction_config.nft_escrow_token_account @ AuctionError::InvalidAuctionState,
    )]
    pub nft_escrow_token_account: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = seller,
        associated_token::mint = nft_mint,
        associated_token::authority = seller,
    )]
    pub seller_nft_account: Account<'info, TokenAccount>,

    #[account(
        constraint = nft_mint.key() == auction_config.nft_mint @ AuctionError::InvalidAuctionState,
    )]
    pub nft_mint: Account<'info, Mint>,

    /// CHECK: NFT escrow authority PDA.
    #[account(
        seeds = [NFT_AUTHORITY_SEED, auction_config.key().as_ref()],
        bump,
    )]
    pub nft_escrow_authority: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum AuctionState {
    Active,
    BiddingClosed,
    ComputationPending,
    WinnerComputed,
    Settled,
    ComputationFailed,
    EmergencyClosed,
}

/// Main auction state and final settlement outputs.
#[account]
#[derive(InitSpace)]
pub struct AuctionConfig {
    pub seller: Pubkey,
    pub nft_mint: Pubkey,
    pub nft_escrow_token_account: Pubkey,
    pub start_ts: i64,
    pub end_ts: i64,
    pub bid_count: u8,
    pub state: AuctionState,
    pub winner_bidder_index: u8,
    pub second_price: u64,
    pub has_valid_winner: bool,
    pub winner_computed: bool,
    pub settled: bool,
    pub find_winner_comp_def: Pubkey,
    pub bump: u8,
}

/// Per-bidder encrypted bid and collateral tracking.
#[account]
#[derive(InitSpace)]
pub struct BidderRecord {
    pub auction_config: Pubkey,
    pub bidder: Pubkey,
    pub bidder_index: u8,
    /// Encrypted ciphertext for BidEntry.amount (u64 field element).
    pub encrypted_bid_amount: [u8; 32],
    /// Encrypted ciphertext for BidEntry.active (bool field element).
    pub encrypted_bid_active: [u8; 32],
    /// Bidder's x25519 public key used for this bid encryption.
    pub encrypted_bid_pubkey: [u8; 32],
    /// Nonce used for this bid's Rescue cipher.
    pub encrypted_bid_nonce: u128,
    pub max_collateral: u64,
    pub has_submitted_bid: bool,
    pub refunded: bool,
    pub is_winner: bool,
    pub bump: u8,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Cluster not set on MXE account")]
    ClusterNotSet,
}

#[error_code]
pub enum AuctionError {
    #[msg("Auction is not active")]
    AuctionNotActive,
    #[msg("Auction is still active")]
    AuctionStillActive,
    #[msg("Auction has not ended")]
    AuctionNotEnded,
    #[msg("Maximum bidder count reached")]
    MaxBiddersReached,
    #[msg("Bid already submitted")]
    BidAlreadySubmitted,
    #[msg("Winner has not been computed")]
    WinnerNotComputed,
    #[msg("Winner has already been computed")]
    WinnerAlreadyComputed,
    #[msg("Auction is already settled")]
    AlreadySettled,
    #[msg("Auction is not settled")]
    NotSettled,
    #[msg("Bidder is the winner")]
    BidderIsWinner,
    #[msg("Bidder is not the winner")]
    BidderIsNotWinner,
    #[msg("Bidder has already been refunded")]
    AlreadyRefunded,
    #[msg("Emergency conditions are not met")]
    EmergencyConditionsNotMet,
    #[msg("Invalid NFT mint supply")]
    InvalidNftMintSupply,
    #[msg("Invalid NFT mint decimals")]
    InvalidNftMintDecimals,
    #[msg("Programmable NFTs are not supported")]
    ProgrammableNftNotSupported,
    #[msg("Invalid metadata account")]
    InvalidMetadataAccount,
    #[msg("Computation failed")]
    ComputationFailed,
    #[msg("Invalid auction state")]
    InvalidAuctionState,
}
