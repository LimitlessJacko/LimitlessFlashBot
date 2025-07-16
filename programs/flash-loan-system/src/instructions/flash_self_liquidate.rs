use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::errors::*;
use crate::utils::*;

#[derive(Accounts)]
pub struct FlashSelfLiquidate<'info> {
    #[account(
        mut,
        seeds = [b"flash_loan_state"],
        bump = flash_loan_state.bump
    )]
    pub flash_loan_state: Account<'info, FlashLoanState>,
    
    #[account(
        init,
        payer = borrower,
        space = ActiveLoan::LEN,
        seeds = [b"active_loan", borrower.key().as_ref()],
        bump
    )]
    pub active_loan: Account<'info, ActiveLoan>,
    
    #[account(mut)]
    pub borrower: Signer<'info>,
    
    /// Source token account (collateral to be liquidated)
    #[account(
        mut,
        constraint = source_token_account.owner == borrower.key()
    )]
    pub source_token_account: Account<'info, TokenAccount>,
    
    /// Destination token account (debt token)
    #[account(
        mut,
        constraint = dest_token_account.owner == borrower.key()
    )]
    pub dest_token_account: Account<'info, TokenAccount>,
    
    /// Flash loan pool token account
    #[account(mut)]
    pub pool_token_account: Account<'info, TokenAccount>,
    
    /// Solend lending pool
    /// CHECK: Validated by Solend program
    pub solend_pool: AccountInfo<'info>,
    
    /// Solend reserve account
    /// CHECK: Validated by Solend program
    pub solend_reserve: AccountInfo<'info>,
    
    /// Solend program
    /// CHECK: This is the Solend program ID
    pub solend_program: AccountInfo<'info>,
    
    /// Jupiter swap program for liquidation
    /// CHECK: This is the Jupiter program ID
    pub jupiter_program: AccountInfo<'info>,
    
    /// Swap accounts for Jupiter
    /// CHECK: Validated by Jupiter program
    pub swap_accounts: AccountInfo<'info>,
    
    /// Oracle account for price feeds
    /// CHECK: Validated by oracle program
    pub oracle_account: AccountInfo<'info>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
    pub clock: Sysvar<'info, Clock>,
}

pub fn handler(ctx: Context<FlashSelfLiquidate>, amount: u64, min_out: u64) -> Result<()> {
    let flash_loan_state = &mut ctx.accounts.flash_loan_state;
    let active_loan = &mut ctx.accounts.active_loan;
    let clock = &ctx.accounts.clock;
    
    // Check if system is paused
    require!(!flash_loan_state.is_paused, FlashLoanError::Unauthorized);
    
    // Validate loan amount
    require!(amount <= flash_loan_state.max_loan_amount, FlashLoanError::ExceedsMaxLoan);
    require!(amount > 0, FlashLoanError::InsufficientFunds);
    
    // Check pool has sufficient liquidity (90% max borrow)
    let pool_balance = ctx.accounts.pool_token_account.amount;
    let max_borrow = pool_balance.checked_mul(9000).unwrap().checked_div(10000).unwrap();
    require!(amount <= max_borrow, FlashLoanError::InsufficientFunds);
    
    // Calculate fee
    let fee = calculate_fee(amount, flash_loan_state.fee_rate)?;
    
    // Initialize active loan
    active_loan.borrower = ctx.accounts.borrower.key();
    active_loan.token_mint = ctx.accounts.pool_token_account.mint;
    active_loan.amount = amount;
    active_loan.fee = fee;
    active_loan.timestamp = clock.unix_timestamp;
    active_loan.loan_type = 0; // Self-liquidate
    active_loan.bump = ctx.bumps.active_loan;
    
    // Step 1: Flash loan from Solend
    solend_flash_loan(
        &ctx.accounts.solend_program,
        &ctx.accounts.solend_pool,
        &ctx.accounts.solend_reserve,
        &ctx.accounts.pool_token_account,
        &ctx.accounts.dest_token_account,
        amount,
    )?;
    
    // Step 2: Get oracle price for liquidation calculation
    let oracle_price = get_oracle_price(&ctx.accounts.oracle_account)?;
    
    // Step 3: Calculate liquidation amount based on collateral value
    let collateral_value = ctx.accounts.source_token_account.amount
        .checked_mul(oracle_price)
        .ok_or(FlashLoanError::MathOverflow)?;
    
    let liquidation_amount = calculate_liquidation_amount(
        collateral_value,
        amount,
        8000, // 80% liquidation threshold
    )?;
    
    // Step 4: Perform swap via Jupiter
    jupiter_swap(
        &ctx.accounts.jupiter_program,
        &ctx.accounts.swap_accounts,
        &ctx.accounts.source_token_account,
        &ctx.accounts.dest_token_account,
        &ctx.accounts.borrower,
        liquidation_amount,
        min_out,
    )?;
    
    // Step 5: Validate slippage
    let actual_out = ctx.accounts.dest_token_account.amount;
    validate_slippage(min_out, actual_out, 500)?; // 5% max slippage
    
    // Step 6: Repay flash loan with fee
    let repay_amount = amount.checked_add(fee).ok_or(FlashLoanError::MathOverflow)?;
    
    // Transfer repayment
    let transfer_accounts = Transfer {
        from: ctx.accounts.dest_token_account.to_account_info(),
        to: ctx.accounts.pool_token_account.to_account_info(),
        authority: ctx.accounts.borrower.to_account_info(),
    };
    
    token::transfer(
        CpiContext::new(ctx.accounts.token_program.to_account_info(), transfer_accounts),
        repay_amount,
    )?;
    
    // Update state
    flash_loan_state.total_loans_issued = flash_loan_state.total_loans_issued.checked_add(1).unwrap();
    flash_loan_state.total_volume = flash_loan_state.total_volume.checked_add(amount).unwrap();
    
    msg!("Flash self-liquidation completed: amount={}, fee={}", amount, fee);
    
    Ok(())
}

// Helper function for Solend flash loan CPI
fn solend_flash_loan<'info>(
    solend_program: &AccountInfo<'info>,
    pool: &AccountInfo<'info>,
    reserve: &AccountInfo<'info>,
    source: &Account<'info, TokenAccount>,
    destination: &Account<'info, TokenAccount>,
    amount: u64,
) -> Result<()> {
    // Solend flash loan instruction data
    let instruction_data = [
        12, // Flash loan instruction discriminator
        amount.to_le_bytes(),
    ].concat();
    
    let accounts = vec![
        AccountMeta::new(pool.key(), false),
        AccountMeta::new(reserve.key(), false),
        AccountMeta::new(source.key(), false),
        AccountMeta::new(destination.key(), false),
    ];
    
    let instruction = solana_program::instruction::Instruction {
        program_id: solend_program.key(),
        accounts,
        data: instruction_data,
    };
    
    solana_program::program::invoke(&instruction, &[
        pool.clone(),
        reserve.clone(),
        source.to_account_info(),
        destination.to_account_info(),
    ])?;
    
    Ok(())
}

// Helper function for Jupiter swap CPI
fn jupiter_swap<'info>(
    jupiter_program: &AccountInfo<'info>,
    swap_accounts: &AccountInfo<'info>,
    source: &Account<'info, TokenAccount>,
    destination: &Account<'info, TokenAccount>,
    authority: &Signer<'info>,
    amount_in: u64,
    minimum_amount_out: u64,
) -> Result<()> {
    // Jupiter swap instruction data
    let instruction_data = [
        1, // Swap instruction discriminator
        amount_in.to_le_bytes(),
        minimum_amount_out.to_le_bytes(),
    ].concat();
    
    let accounts = vec![
        AccountMeta::new(source.key(), false),
        AccountMeta::new(destination.key(), false),
        AccountMeta::new(authority.key(), true),
        AccountMeta::new_readonly(swap_accounts.key(), false),
    ];
    
    let instruction = solana_program::instruction::Instruction {
        program_id: jupiter_program.key(),
        accounts,
        data: instruction_data,
    };
    
    solana_program::program::invoke(&instruction, &[
        source.to_account_info(),
        destination.to_account_info(),
        authority.to_account_info(),
        swap_accounts.clone(),
    ])?;
    
    Ok(())
}

