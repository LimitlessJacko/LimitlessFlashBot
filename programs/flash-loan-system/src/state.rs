use anchor_lang::prelude::*;

#[account]
pub struct FlashLoanState {
    /// Authority that can perform emergency operations
    pub authority: Pubkey,
    /// Bump seed for PDA
    pub bump: u8,
    /// Total flash loans issued
    pub total_loans_issued: u64,
    /// Total volume processed
    pub total_volume: u64,
    /// Fee rate (basis points)
    pub fee_rate: u16,
    /// Maximum loan amount per transaction
    pub max_loan_amount: u64,
    /// Emergency pause flag
    pub is_paused: bool,
    /// Supported tokens count
    pub supported_tokens_count: u8,
    /// Reserved space for future upgrades
    pub reserved: [u8; 64],
}

impl FlashLoanState {
    pub const LEN: usize = 8 + // discriminator
        32 + // authority
        1 +  // bump
        8 +  // total_loans_issued
        8 +  // total_volume
        2 +  // fee_rate
        8 +  // max_loan_amount
        1 +  // is_paused
        1 +  // supported_tokens_count
        64;  // reserved
}

#[account]
pub struct ActiveLoan {
    /// Borrower's public key
    pub borrower: Pubkey,
    /// Token mint being borrowed
    pub token_mint: Pubkey,
    /// Amount borrowed
    pub amount: u64,
    /// Fee to be paid
    pub fee: u64,
    /// Timestamp when loan was taken
    pub timestamp: i64,
    /// Loan type (0: self-liquidate, 1: arbitrage)
    pub loan_type: u8,
    /// Bump seed
    pub bump: u8,
    /// Reserved space
    pub reserved: [u8; 32],
}

impl ActiveLoan {
    pub const LEN: usize = 8 + // discriminator
        32 + // borrower
        32 + // token_mint
        8 +  // amount
        8 +  // fee
        8 +  // timestamp
        1 +  // loan_type
        1 +  // bump
        32;  // reserved
}

#[account]
pub struct TokenConfig {
    /// Token mint
    pub mint: Pubkey,
    /// Maximum loan percentage (basis points)
    pub max_loan_percentage: u16,
    /// Oracle account for price feeds
    pub oracle: Pubkey,
    /// Is token active for loans
    pub is_active: bool,
    /// Reserved space
    pub reserved: [u8; 32],
}

impl TokenConfig {
    pub const LEN: usize = 8 + // discriminator
        32 + // mint
        2 +  // max_loan_percentage
        32 + // oracle
        1 +  // is_active
        32;  // reserved
}

#[account]
pub struct ArbitrageConfig {
    /// DEX identifier
    pub dex_id: u8,
    /// DEX program ID
    pub dex_program: Pubkey,
    /// Fee rate for this DEX
    pub fee_rate: u16,
    /// Minimum trade amount
    pub min_trade_amount: u64,
    /// Is DEX active
    pub is_active: bool,
    /// Reserved space
    pub reserved: [u8; 32],
}

impl ArbitrageConfig {
    pub const LEN: usize = 8 + // discriminator
        1 +  // dex_id
        32 + // dex_program
        2 +  // fee_rate
        8 +  // min_trade_amount
        1 +  // is_active
        32;  // reserved
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct SwapParams {
    pub amount_in: u64,
    pub minimum_amount_out: u64,
    pub deadline: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct DexRoute {
    pub dex_id: u8,
    pub token_in: Pubkey,
    pub token_out: Pubkey,
    pub pool_address: Pubkey,
}

