use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    #[derive(Copy, Clone)]
    pub struct BidEntry {
        pub amount: u64,
        pub active: bool,
    }

    #[instruction]
    pub fn find_winner(
        bids: [Enc<Shared, BidEntry>; 8],
        max_collaterals: [u64; 8],
    ) -> (u8, u64, bool) {
        let mut amounts = [0u64; 8];
        let mut valid = [false; 8];
        let mut valid_count = 0u8;

        for i in 0..8 {
            let bid = bids[i].to_arcis();
            let is_valid = bid.active
                && (max_collaterals[i] > 0)
                && (bid.amount <= max_collaterals[i]);
            valid[i] = is_valid;
            amounts[i] = if is_valid { bid.amount } else { 0 };
            valid_count += is_valid as u8;
        }

        let mut max_amount = 0u64;
        let mut max_index = 0u8;

        for i in 0..8 {
            let should_update = valid[i] && amounts[i] > max_amount;
            if should_update {
                max_amount = amounts[i];
                max_index = i as u8;
            }
        }

        let mut second_max = 0u64;

        for i in 0..8 {
            let not_winner = (i as u8) != max_index;
            let should_update = valid[i] && not_winner && amounts[i] > second_max;
            if should_update {
                second_max = amounts[i];
            }
        }

        let has_valid_winner = valid_count >= 1;
        let one_valid_bid = valid_count == 1;
        let vickrey_price = if one_valid_bid { max_amount } else { second_max };
        let winner_index = if has_valid_winner { max_index } else { 0 };
        let second_price = if has_valid_winner { vickrey_price } else { 0 };

        (
            winner_index.reveal(),
            second_price.reveal(),
            has_valid_winner.reveal(),
        )
    }
}
