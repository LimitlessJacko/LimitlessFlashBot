use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::errors::*;

#[derive(Accounts)]
pub struct EmergencyWithdraw<'info> {
    #[account(
        mut,
        seeds = [b"flash_loan_state"],
        bump = flash_loan_state.bump,
        constraint = flash_loan_state.authority == authority.key() @ FlashLoanError::Unauthorized
    )]
    pub flash_loan_state: Account<'info, FlashLoanState>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// Pool token account to withdraw from
    #[account(mut)]
    pub pool_token_account: Account<'info, TokenAccount>,
    
    /// Authority's token account to receive funds
    #[account(
        mut,
        constraint = authority_token_account.owner == authority.key(),
        constraint = authority_token_account.mint == pool_token_account.mint
    )]
    pub authority_token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<EmergencyWithdraw>, amount: u64) -> Result<()> {
    let flash_loan_state = &mut ctx.accounts.flash_loan_state;
    
    // Ensure system is paused for emergency operations
    require!(flash_loan_state.is_paused, FlashLoanError::Unauthorized);
    
    // Validate withdrawal amount
    require!(amount > 0, FlashLoanError::InsufficientFunds);
    require!(
        amount <= ctx.accounts.pool_token_account.amount,
        FlashLoanError::InsufficientFunds
    );
    
    // Transfer funds to authority
    let seeds = &[
        b"flash_loan_state",
        &[flash_loan_state.bump],
    ];
    let signer_seeds = &[&seeds[..]];
    
    let transfer_accounts = Transfer {
        from: ctx.accounts.pool_token_account.to_account_info(),
        to: ctx.accounts.authority_token_account.to_account_info(),
        authority: flash_loan_state.to_account_info(),
    };
    
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            transfer_accounts,
            signer_seeds,
        ),
        amount,
    )?;
    
    msg!("Emergency withdrawal completed: amount={}", amount);
    
    Ok(())
}

