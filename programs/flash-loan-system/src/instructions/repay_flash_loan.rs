use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::errors::*;

#[derive(Accounts)]
pub struct RepayFlashLoan<'info> {
    #[account(
        mut,
        seeds = [b"flash_loan_state"],
        bump = flash_loan_state.bump
    )]
    pub flash_loan_state: Account<'info, FlashLoanState>,
    
    #[account(
        mut,
        close = borrower,
        seeds = [b"active_loan", borrower.key().as_ref()],
        bump = active_loan.bump,
        constraint = active_loan.borrower == borrower.key()
    )]
    pub active_loan: Account<'info, ActiveLoan>,
    
    #[account(mut)]
    pub borrower: Signer<'info>,
    
    /// Borrower's token account for repayment
    #[account(
        mut,
        constraint = borrower_token_account.owner == borrower.key(),
        constraint = borrower_token_account.mint == active_loan.token_mint
    )]
    pub borrower_token_account: Account<'info, TokenAccount>,
    
    /// Flash loan pool token account
    #[account(
        mut,
        constraint = pool_token_account.mint == active_loan.token_mint
    )]
    pub pool_token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
    pub clock: Sysvar<'info, Clock>,
}

pub fn handler(ctx: Context<RepayFlashLoan>, amount: u64) -> Result<()> {
    let active_loan = &ctx.accounts.active_loan;
    let clock = &ctx.accounts.clock;
    
    // Validate repayment amount includes fee
    let required_amount = active_loan.amount.checked_add(active_loan.fee)
        .ok_or(FlashLoanError::MathOverflow)?;
    
    require!(amount >= required_amount, FlashLoanError::InsufficientFunds);
    
    // Check loan hasn't expired (5 minute window)
    let loan_duration = clock.unix_timestamp - active_loan.timestamp;
    require!(loan_duration <= 300, FlashLoanError::LoanNotRepaid);
    
    // Transfer repayment to pool
    let transfer_accounts = Transfer {
        from: ctx.accounts.borrower_token_account.to_account_info(),
        to: ctx.accounts.pool_token_account.to_account_info(),
        authority: ctx.accounts.borrower.to_account_info(),
    };
    
    token::transfer(
        CpiContext::new(ctx.accounts.token_program.to_account_info(), transfer_accounts),
        required_amount,
    )?;
    
    // Return any excess to borrower
    if amount > required_amount {
        let excess = amount - required_amount;
        let return_accounts = Transfer {
            from: ctx.accounts.pool_token_account.to_account_info(),
            to: ctx.accounts.borrower_token_account.to_account_info(),
            authority: ctx.accounts.flash_loan_state.to_account_info(),
        };
        
        let seeds = &[
            b"flash_loan_state",
            &[ctx.accounts.flash_loan_state.bump],
        ];
        let signer_seeds = &[&seeds[..]];
        
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                return_accounts,
                signer_seeds,
            ),
            excess,
        )?;
    }
    
    msg!("Flash loan repaid: amount={}, fee={}", active_loan.amount, active_loan.fee);
    
    // Active loan account is automatically closed due to close constraint
    
    Ok(())
}

