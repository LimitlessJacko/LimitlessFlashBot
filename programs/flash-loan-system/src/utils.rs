use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::errors::FlashLoanError;

pub fn calculate_fee(amount: u64, fee_rate: u16) -> Result<u64> {
    amount
        .checked_mul(fee_rate as u64)
        .and_then(|x| x.checked_div(10000))
        .ok_or(FlashLoanError::MathOverflow.into())
}

pub fn validate_slippage(expected: u64, actual: u64, max_slippage: u16) -> Result<()> {
    let slippage = if expected > actual {
        ((expected - actual) * 10000) / expected
    } else {
        0
    };
    
    if slippage > max_slippage as u64 {
        return Err(FlashLoanError::SlippageExceeded.into());
    }
    
    Ok(())
}

pub fn transfer_tokens<'info>(
    from: &Account<'info, TokenAccount>,
    to: &Account<'info, TokenAccount>,
    authority: &AccountInfo<'info>,
    token_program: &Program<'info, Token>,
    amount: u64,
    signer_seeds: Option<&[&[&[u8]]]>,
) -> Result<()> {
    let cpi_accounts = Transfer {
        from: from.to_account_info(),
        to: to.to_account_info(),
        authority: authority.clone(),
    };
    
    let cpi_program = token_program.to_account_info();
    
    if let Some(seeds) = signer_seeds {
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, seeds);
        token::transfer(cpi_ctx, amount)
    } else {
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)
    }
}

pub fn get_oracle_price(oracle_account: &AccountInfo) -> Result<u64> {
    // Placeholder for oracle price fetching
    // In production, this would integrate with Pyth, Switchboard, or other oracles
    Ok(100_000_000) // $100 in lamports (placeholder)
}

pub fn calculate_liquidation_amount(
    collateral_value: u64,
    debt_value: u64,
    liquidation_threshold: u16,
) -> Result<u64> {
    let threshold_value = collateral_value
        .checked_mul(liquidation_threshold as u64)
        .and_then(|x| x.checked_div(10000))
        .ok_or(FlashLoanError::MathOverflow)?;
    
    if debt_value <= threshold_value {
        return Err(FlashLoanError::LiquidationThresholdNotMet.into());
    }
    
    // Calculate liquidation amount (50% of debt for safety)
    debt_value
        .checked_div(2)
        .ok_or(FlashLoanError::MathOverflow.into())
}

pub fn validate_dex_route(route: &[u8]) -> Result<Vec<crate::state::DexRoute>> {
    if route.is_empty() || route.len() % 73 != 0 {
        return Err(FlashLoanError::InvalidDexRoute.into());
    }
    
    let mut parsed_routes = Vec::new();
    let mut i = 0;
    
    while i < route.len() {
        if i + 73 > route.len() {
            return Err(FlashLoanError::InvalidDexRoute.into());
        }
        
        let dex_id = route[i];
        let token_in = Pubkey::try_from(&route[i+1..i+33])
            .map_err(|_| FlashLoanError::InvalidDexRoute)?;
        let token_out = Pubkey::try_from(&route[i+33..i+65])
            .map_err(|_| FlashLoanError::InvalidDexRoute)?;
        let pool_address = Pubkey::try_from(&route[i+65..i+97])
            .map_err(|_| FlashLoanError::InvalidDexRoute)?;
        
        parsed_routes.push(crate::state::DexRoute {
            dex_id,
            token_in,
            token_out,
            pool_address,
        });
        
        i += 73;
    }
    
    Ok(parsed_routes)
}

pub fn calculate_arbitrage_profit(
    amount_in: u64,
    price_a: u64,
    price_b: u64,
    fee_a: u16,
    fee_b: u16,
) -> Result<u64> {
    let amount_after_fee_a = amount_in
        .checked_mul(10000 - fee_a as u64)
        .and_then(|x| x.checked_div(10000))
        .ok_or(FlashLoanError::MathOverflow)?;
    
    let amount_out_a = amount_after_fee_a
        .checked_mul(price_a)
        .and_then(|x| x.checked_div(1_000_000))
        .ok_or(FlashLoanError::MathOverflow)?;
    
    let amount_after_fee_b = amount_out_a
        .checked_mul(10000 - fee_b as u64)
        .and_then(|x| x.checked_div(10000))
        .ok_or(FlashLoanError::MathOverflow)?;
    
    let final_amount = amount_after_fee_b
        .checked_mul(price_b)
        .and_then(|x| x.checked_div(1_000_000))
        .ok_or(FlashLoanError::MathOverflow)?;
    
    if final_amount > amount_in {
        Ok(final_amount - amount_in)
    } else {
        Ok(0)
    }
}

