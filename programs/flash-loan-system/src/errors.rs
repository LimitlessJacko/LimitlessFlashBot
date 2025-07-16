use anchor_lang::prelude::*;

#[error_code]
pub enum FlashLoanError {
    #[msg("Insufficient funds for flash loan")]
    InsufficientFunds,
    
    #[msg("Flash loan not repaid in time")]
    LoanNotRepaid,
    
    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,
    
    #[msg("Arbitrage opportunity not profitable")]
    UnprofitableArbitrage,
    
    #[msg("Invalid DEX route provided")]
    InvalidDexRoute,
    
    #[msg("Flash loan amount exceeds maximum allowed")]
    ExceedsMaxLoan,
    
    #[msg("Unauthorized access")]
    Unauthorized,
    
    #[msg("Invalid token account")]
    InvalidTokenAccount,
    
    #[msg("Math overflow")]
    MathOverflow,
    
    #[msg("Invalid oracle price")]
    InvalidOraclePrice,
    
    #[msg("Liquidation threshold not met")]
    LiquidationThresholdNotMet,
    
    #[msg("Flash loan already active")]
    FlashLoanActive,
    
    #[msg("Invalid swap parameters")]
    InvalidSwapParams,
    
    #[msg("DEX interaction failed")]
    DexInteractionFailed,
    
    #[msg("Price impact too high")]
    PriceImpactTooHigh,
}

