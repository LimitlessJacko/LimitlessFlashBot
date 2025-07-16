use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use solana_program::{
    program::invoke_signed,
    system_instruction,
    sysvar::{clock::Clock, rent::Rent},
};

declare_id!("FLashLoanSys11111111111111111111111111111111");

pub mod errors;
pub mod instructions;
pub mod state;
pub mod utils;

use errors::*;
use instructions::*;
use state::*;

#[program]
pub mod flash_loan_system {
    use super::*;

    /// Initialize the flash loan system
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize::handler(ctx)
    }

    /// Flash loan self-liquidation with automatic swap repayment
    pub fn flash_self_liquidate(
        ctx: Context<FlashSelfLiquidate>,
        amount: u64,
        min_out: u64,
    ) -> Result<()> {
        instructions::flash_self_liquidate::handler(ctx, amount, min_out)
    }

    /// Flash loan arbitrage across DEXs
    pub fn flash_arbitrage(
        ctx: Context<FlashArbitrage>,
        amount: u64,
        min_profit: u64,
        dex_route: Vec<u8>,
    ) -> Result<()> {
        instructions::flash_arbitrage::handler(ctx, amount, min_profit, dex_route)
    }

    /// Repay flash loan
    pub fn repay_flash_loan(ctx: Context<RepayFlashLoan>, amount: u64) -> Result<()> {
        instructions::repay_flash_loan::handler(ctx, amount)
    }

    /// Emergency withdraw (admin only)
    pub fn emergency_withdraw(ctx: Context<EmergencyWithdraw>, amount: u64) -> Result<()> {
        instructions::emergency_withdraw::handler(ctx, amount)
    }
}

