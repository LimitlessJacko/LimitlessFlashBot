use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::errors::*;
use crate::utils::*;

#[derive(Accounts)]
pub struct FlashArbitrage<'info> {
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
    
    /// Source token account
    #[account(
        mut,
        constraint = source_token_account.owner == borrower.key()
    )]
    pub source_token_account: Account<'info, TokenAccount>,
    
    /// Intermediate token account for arbitrage
    #[account(
        mut,
        constraint = intermediate_token_account.owner == borrower.key()
    )]
    pub intermediate_token_account: Account<'info, TokenAccount>,
    
    /// Flash loan pool token account
    #[account(mut)]
    pub pool_token_account: Account<'info, TokenAccount>,
    
    /// Solend lending pool
    /// CHECK: Validated by Solend program
    pub solend_pool: AccountInfo<'info>,
    
    /// Solend reserve account
    /// CHECK: Validated by Solend program
    pub solend_reserve: AccountInfo<'info>,
    
    /// Save Finance pool
    /// CHECK: Validated by Save Finance program
    pub save_finance_pool: AccountInfo<'info>,
    
    /// Save Finance reserve
    /// CHECK: Validated by Save Finance program
    pub save_finance_reserve: AccountInfo<'info>,
    
    /// Solend program
    /// CHECK: This is the Solend program ID
    pub solend_program: AccountInfo<'info>,
    
    /// Save Finance program
    /// CHECK: This is the Save Finance program ID
    pub save_finance_program: AccountInfo<'info>,
    
    /// DEX A program (e.g., Raydium)
    /// CHECK: This is DEX A program ID
    pub dex_a_program: AccountInfo<'info>,
    
    /// DEX B program (e.g., Orca)
    /// CHECK: This is DEX B program ID
    pub dex_b_program: AccountInfo<'info>,
    
    /// DEX A pool accounts
    /// CHECK: Validated by DEX A program
    pub dex_a_accounts: AccountInfo<'info>,
    
    /// DEX B pool accounts
    /// CHECK: Validated by DEX B program
    pub dex_b_accounts: AccountInfo<'info>,
    
    /// Oracle accounts for price validation
    /// CHECK: Validated by oracle program
    pub oracle_a: AccountInfo<'info>,
    
    /// CHECK: Validated by oracle program
    pub oracle_b: AccountInfo<'info>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
    pub clock: Sysvar<'info, Clock>,
}

pub fn handler(
    ctx: Context<FlashArbitrage>,
    amount: u64,
    min_profit: u64,
    dex_route: Vec<u8>,
) -> Result<()> {
    let flash_loan_state = &mut ctx.accounts.flash_loan_state;
    let active_loan = &mut ctx.accounts.active_loan;
    let clock = &ctx.accounts.clock;
    
    // Check if system is paused
    require!(!flash_loan_state.is_paused, FlashLoanError::Unauthorized);
    
    // Validate loan amount
    require!(amount <= flash_loan_state.max_loan_amount, FlashLoanError::ExceedsMaxLoan);
    require!(amount > 0, FlashLoanError::InsufficientFunds);
    
    // Parse and validate DEX route
    let parsed_route = validate_dex_route(&dex_route)?;
    require!(!parsed_route.is_empty(), FlashLoanError::InvalidDexRoute);
    
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
    active_loan.loan_type = 1; // Arbitrage
    active_loan.bump = ctx.bumps.active_loan;
    
    // Step 1: Get oracle prices for arbitrage validation
    let price_a = get_oracle_price(&ctx.accounts.oracle_a)?;
    let price_b = get_oracle_price(&ctx.accounts.oracle_b)?;
    
    // Step 2: Calculate expected profit
    let expected_profit = calculate_arbitrage_profit(amount, price_a, price_b, 25, 30)?; // 0.25% and 0.3% fees
    require!(expected_profit >= min_profit, FlashLoanError::UnprofitableArbitrage);
    
    // Step 3: Flash loan from Solend (primary) or Save Finance (backup)
    let flash_loan_result = solend_flash_loan(
        &ctx.accounts.solend_program,
        &ctx.accounts.solend_pool,
        &ctx.accounts.solend_reserve,
        &ctx.accounts.pool_token_account,
        &ctx.accounts.source_token_account,
        amount,
    );
    
    if flash_loan_result.is_err() {
        // Fallback to Save Finance
        save_finance_flash_loan(
            &ctx.accounts.save_finance_program,
            &ctx.accounts.save_finance_pool,
            &ctx.accounts.save_finance_reserve,
            &ctx.accounts.pool_token_account,
            &ctx.accounts.source_token_account,
            amount,
        )?;
    }
    
    // Step 4: Execute arbitrage trades
    let initial_balance = ctx.accounts.source_token_account.amount;
    
    // Trade on DEX A
    dex_swap(
        &ctx.accounts.dex_a_program,
        &ctx.accounts.dex_a_accounts,
        &ctx.accounts.source_token_account,
        &ctx.accounts.intermediate_token_account,
        &ctx.accounts.borrower,
        amount,
        0, // No minimum for intermediate step
    )?;
    
    // Trade on DEX B (back to original token)
    let intermediate_balance = ctx.accounts.intermediate_token_account.amount;
    dex_swap(
        &ctx.accounts.dex_b_program,
        &ctx.accounts.dex_b_accounts,
        &ctx.accounts.intermediate_token_account,
        &ctx.accounts.source_token_account,
        &ctx.accounts.borrower,
        intermediate_balance,
        amount.checked_add(fee).unwrap(), // Must cover loan + fee
    )?;
    
    // Step 5: Validate profit
    let final_balance = ctx.accounts.source_token_account.amount;
    let actual_profit = final_balance.checked_sub(initial_balance).ok_or(FlashLoanError::UnprofitableArbitrage)?;
    require!(actual_profit >= min_profit, FlashLoanError::UnprofitableArbitrage);
    
    // Step 6: Repay flash loan with fee
    let repay_amount = amount.checked_add(fee).ok_or(FlashLoanError::MathOverflow)?;
    
    // Transfer repayment
    let transfer_accounts = Transfer {
        from: ctx.accounts.source_token_account.to_account_info(),
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
    
    msg!("Flash arbitrage completed: amount={}, fee={}, profit={}", amount, fee, actual_profit);
    
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

// Helper function for Save Finance flash loan CPI
fn save_finance_flash_loan<'info>(
    save_program: &AccountInfo<'info>,
    pool: &AccountInfo<'info>,
    reserve: &AccountInfo<'info>,
    source: &Account<'info, TokenAccount>,
    destination: &Account<'info, TokenAccount>,
    amount: u64,
) -> Result<()> {
    // Save Finance flash loan instruction data
    let instruction_data = [
        8, // Flash loan instruction discriminator for Save Finance
        amount.to_le_bytes(),
    ].concat();
    
    let accounts = vec![
        AccountMeta::new(pool.key(), false),
        AccountMeta::new(reserve.key(), false),
        AccountMeta::new(source.key(), false),
        AccountMeta::new(destination.key(), false),
    ];
    
    let instruction = solana_program::instruction::Instruction {
        program_id: save_program.key(),
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

// Helper function for DEX swap CPI
fn dex_swap<'info>(
    dex_program: &AccountInfo<'info>,
    pool_accounts: &AccountInfo<'info>,
    source: &Account<'info, TokenAccount>,
    destination: &Account<'info, TokenAccount>,
    authority: &Signer<'info>,
    amount_in: u64,
    minimum_amount_out: u64,
) -> Result<()> {
    // Generic DEX swap instruction data
    let instruction_data = [
        9, // Swap instruction discriminator
        amount_in.to_le_bytes(),
        minimum_amount_out.to_le_bytes(),
    ].concat();
    
    let accounts = vec![
        AccountMeta::new(source.key(), false),
        AccountMeta::new(destination.key(), false),
        AccountMeta::new(authority.key(), true),
        AccountMeta::new_readonly(pool_accounts.key(), false),
    ];
    
    let instruction = solana_program::instruction::Instruction {
        program_id: dex_program.key(),
        accounts,
        data: instruction_data,
    };
    
    solana_program::program::invoke(&instruction, &[
        source.to_account_info(),
        destination.to_account_info(),
        authority.to_account_info(),
        pool_accounts.clone(),
    ])?;
    
    Ok(())
}

