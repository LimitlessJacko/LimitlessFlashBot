use anchor_lang::prelude::*;
use crate::state::*;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = FlashLoanState::LEN,
        seeds = [b"flash_loan_state"],
        bump
    )]
    pub flash_loan_state: Account<'info, FlashLoanState>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<Initialize>) -> Result<()> {
    let flash_loan_state = &mut ctx.accounts.flash_loan_state;
    
    flash_loan_state.authority = ctx.accounts.authority.key();
    flash_loan_state.bump = ctx.bumps.flash_loan_state;
    flash_loan_state.total_loans_issued = 0;
    flash_loan_state.total_volume = 0;
    flash_loan_state.fee_rate = 30; // 0.3% fee
    flash_loan_state.max_loan_amount = 1_000_000_000_000; // 1M tokens max
    flash_loan_state.is_paused = false;
    flash_loan_state.supported_tokens_count = 0;
    flash_loan_state.reserved = [0; 64];
    
    msg!("Flash loan system initialized with authority: {}", ctx.accounts.authority.key());
    
    Ok(())
}

