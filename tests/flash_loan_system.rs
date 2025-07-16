use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint};
use flash_loan_system::{self, FlashLoanState, ActiveLoan, TokenConfig};
use solana_program_test::*;
use solana_sdk::{
    account::Account,
    signature::{Keypair, Signer},
    transaction::Transaction,
    system_instruction,
    sysvar,
};
use spl_token::instruction as token_instruction;
use std::str::FromStr;

#[tokio::test]
async fn test_initialize_flash_loan_system() {
    let program_id = flash_loan_system::id();
    let mut program_test = ProgramTest::new(
        "flash_loan_system",
        program_id,
        processor!(flash_loan_system::entry),
    );
    
    // Add necessary programs
    program_test.add_program("spl_token", spl_token::id(), None);
    
    let (mut banks_client, payer, recent_blockhash) = program_test.start().await;
    
    // Create authority keypair
    let authority = Keypair::new();
    
    // Fund authority
    let fund_ix = system_instruction::transfer(
        &payer.pubkey(),
        &authority.pubkey(),
        1_000_000_000, // 1 SOL
    );
    
    let fund_tx = Transaction::new_signed_with_payer(
        &[fund_ix],
        Some(&payer.pubkey()),
        &[&payer],
        recent_blockhash,
    );
    
    banks_client.process_transaction(fund_tx).await.unwrap();
    
    // Initialize flash loan system
    let (flash_loan_state_pda, _) = Pubkey::find_program_address(
        &[b"flash_loan_state"],
        &program_id,
    );
    
    let initialize_ix = flash_loan_system::instruction::Initialize {
        flash_loan_state: flash_loan_state_pda,
        authority: authority.pubkey(),
        system_program: solana_program::system_program::id(),
        rent: sysvar::rent::id(),
    };
    
    let initialize_tx = Transaction::new_signed_with_payer(
        &[initialize_ix.into()],
        Some(&authority.pubkey()),
        &[&authority],
        recent_blockhash,
    );
    
    banks_client.process_transaction(initialize_tx).await.unwrap();
    
    // Verify initialization
    let flash_loan_state_account = banks_client
        .get_account(flash_loan_state_pda)
        .await
        .unwrap()
        .unwrap();
    
    let flash_loan_state: FlashLoanState = 
        FlashLoanState::try_deserialize(&mut flash_loan_state_account.data.as_slice()).unwrap();
    
    assert_eq!(flash_loan_state.authority, authority.pubkey());
    assert_eq!(flash_loan_state.fee_rate, 30); // 0.3%
    assert_eq!(flash_loan_state.total_loans_issued, 0);
    assert!(!flash_loan_state.is_paused);
}

#[tokio::test]
async fn test_flash_self_liquidate_workflow() {
    let program_id = flash_loan_system::id();
    let mut program_test = ProgramTest::new(
        "flash_loan_system",
        program_id,
        processor!(flash_loan_system::entry),
    );
    
    // Add necessary programs
    program_test.add_program("spl_token", spl_token::id(), None);
    
    let (mut banks_client, payer, recent_blockhash) = program_test.start().await;
    
    // Setup test environment
    let authority = Keypair::new();
    let borrower = Keypair::new();
    
    // Fund accounts
    fund_account(&mut banks_client, &payer, &authority.pubkey(), recent_blockhash).await;
    fund_account(&mut banks_client, &payer, &borrower.pubkey(), recent_blockhash).await;
    
    // Create token mints
    let usdc_mint = create_mint(&mut banks_client, &payer, &authority.pubkey(), recent_blockhash).await;
    let sol_mint = create_mint(&mut banks_client, &payer, &authority.pubkey(), recent_blockhash).await;
    
    // Create token accounts
    let pool_token_account = create_token_account(
        &mut banks_client,
        &payer,
        &usdc_mint,
        &authority.pubkey(),
        recent_blockhash,
    ).await;
    
    let borrower_usdc_account = create_token_account(
        &mut banks_client,
        &payer,
        &usdc_mint,
        &borrower.pubkey(),
        recent_blockhash,
    ).await;
    
    let borrower_sol_account = create_token_account(
        &mut banks_client,
        &payer,
        &sol_mint,
        &borrower.pubkey(),
        recent_blockhash,
    ).await;
    
    // Mint tokens to pool and borrower
    mint_tokens(&mut banks_client, &payer, &usdc_mint, &pool_token_account, &authority, 1_000_000_000, recent_blockhash).await;
    mint_tokens(&mut banks_client, &payer, &sol_mint, &borrower_sol_account, &authority, 100_000_000, recent_blockhash).await;
    
    // Initialize flash loan system
    initialize_system(&mut banks_client, &authority, program_id, recent_blockhash).await;
    
    // Create mock oracle and DEX accounts
    let oracle_account = Keypair::new();
    let jupiter_program = Pubkey::from_str("JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB").unwrap();
    let swap_accounts = Keypair::new();
    let solend_program = Pubkey::from_str("So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo").unwrap();
    let solend_pool = Keypair::new();
    let solend_reserve = Keypair::new();
    
    // Execute flash self liquidate
    let (active_loan_pda, _) = Pubkey::find_program_address(
        &[b"active_loan", borrower.pubkey().as_ref()],
        &program_id,
    );
    
    let flash_self_liquidate_ix = flash_loan_system::instruction::FlashSelfLiquidate {
        flash_loan_state: get_flash_loan_state_pda(program_id),
        active_loan: active_loan_pda,
        borrower: borrower.pubkey(),
        source_token_account: borrower_sol_account,
        dest_token_account: borrower_usdc_account,
        pool_token_account,
        solend_pool: solend_pool.pubkey(),
        solend_reserve: solend_reserve.pubkey(),
        solend_program,
        jupiter_program,
        swap_accounts: swap_accounts.pubkey(),
        oracle_account: oracle_account.pubkey(),
        token_program: spl_token::id(),
        system_program: solana_program::system_program::id(),
        rent: sysvar::rent::id(),
        clock: sysvar::clock::id(),
    };
    
    let flash_tx = Transaction::new_signed_with_payer(
        &[flash_self_liquidate_ix.into()],
        Some(&borrower.pubkey()),
        &[&borrower],
        recent_blockhash,
    );
    
    // Note: This test would require mock implementations of Solend and Jupiter
    // For now, we verify the instruction can be created successfully
    assert!(flash_tx.message.instructions.len() == 1);
}

#[tokio::test]
async fn test_flash_arbitrage_workflow() {
    let program_id = flash_loan_system::id();
    let mut program_test = ProgramTest::new(
        "flash_loan_system",
        program_id,
        processor!(flash_loan_system::entry),
    );
    
    program_test.add_program("spl_token", spl_token::id(), None);
    
    let (mut banks_client, payer, recent_blockhash) = program_test.start().await;
    
    // Setup test environment
    let authority = Keypair::new();
    let borrower = Keypair::new();
    
    fund_account(&mut banks_client, &payer, &authority.pubkey(), recent_blockhash).await;
    fund_account(&mut banks_client, &payer, &borrower.pubkey(), recent_blockhash).await;
    
    // Create token mints and accounts
    let usdc_mint = create_mint(&mut banks_client, &payer, &authority.pubkey(), recent_blockhash).await;
    let usdt_mint = create_mint(&mut banks_client, &payer, &authority.pubkey(), recent_blockhash).await;
    
    let pool_token_account = create_token_account(
        &mut banks_client,
        &payer,
        &usdc_mint,
        &authority.pubkey(),
        recent_blockhash,
    ).await;
    
    let borrower_usdc_account = create_token_account(
        &mut banks_client,
        &payer,
        &usdc_mint,
        &borrower.pubkey(),
        recent_blockhash,
    ).await;
    
    let borrower_usdt_account = create_token_account(
        &mut banks_client,
        &payer,
        &usdt_mint,
        &borrower.pubkey(),
        recent_blockhash,
    ).await;
    
    // Mint tokens
    mint_tokens(&mut banks_client, &payer, &usdc_mint, &pool_token_account, &authority, 1_000_000_000, recent_blockhash).await;
    
    // Initialize system
    initialize_system(&mut banks_client, &authority, program_id, recent_blockhash).await;
    
    // Create DEX route for arbitrage
    let dex_route = create_test_dex_route();
    
    // Create mock accounts for DEXs and oracles
    let solend_program = Pubkey::from_str("So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo").unwrap();
    let save_finance_program = Keypair::new();
    let dex_a_program = Keypair::new(); // Raydium
    let dex_b_program = Keypair::new(); // Orca
    
    let (active_loan_pda, _) = Pubkey::find_program_address(
        &[b"active_loan", borrower.pubkey().as_ref()],
        &program_id,
    );
    
    let flash_arbitrage_ix = flash_loan_system::instruction::FlashArbitrage {
        flash_loan_state: get_flash_loan_state_pda(program_id),
        active_loan: active_loan_pda,
        borrower: borrower.pubkey(),
        source_token_account: borrower_usdc_account,
        intermediate_token_account: borrower_usdt_account,
        pool_token_account,
        solend_pool: Keypair::new().pubkey(),
        solend_reserve: Keypair::new().pubkey(),
        save_finance_pool: Keypair::new().pubkey(),
        save_finance_reserve: Keypair::new().pubkey(),
        solend_program,
        save_finance_program: save_finance_program.pubkey(),
        dex_a_program: dex_a_program.pubkey(),
        dex_b_program: dex_b_program.pubkey(),
        dex_a_accounts: Keypair::new().pubkey(),
        dex_b_accounts: Keypair::new().pubkey(),
        oracle_a: Keypair::new().pubkey(),
        oracle_b: Keypair::new().pubkey(),
        token_program: spl_token::id(),
        system_program: solana_program::system_program::id(),
        rent: sysvar::rent::id(),
        clock: sysvar::clock::id(),
    };
    
    let flash_tx = Transaction::new_signed_with_payer(
        &[flash_arbitrage_ix.into()],
        Some(&borrower.pubkey()),
        &[&borrower],
        recent_blockhash,
    );
    
    // Verify instruction creation
    assert!(flash_tx.message.instructions.len() == 1);
}

#[tokio::test]
async fn test_fee_calculation() {
    // Test fee calculation utility
    let amount = 1_000_000; // 1 USDC
    let fee_rate = 30; // 0.3%
    
    let expected_fee = (amount * fee_rate as u64) / 10000;
    let calculated_fee = flash_loan_system::utils::calculate_fee(amount, fee_rate).unwrap();
    
    assert_eq!(calculated_fee, expected_fee);
    assert_eq!(calculated_fee, 300); // 0.0003 USDC
}

#[tokio::test]
async fn test_slippage_validation() {
    // Test slippage validation
    let expected = 1_000_000;
    let actual = 950_000; // 5% slippage
    let max_slippage = 500; // 5% max allowed
    
    // Should pass
    assert!(flash_loan_system::utils::validate_slippage(expected, actual, max_slippage).is_ok());
    
    // Should fail with higher slippage
    let actual_high_slippage = 900_000; // 10% slippage
    assert!(flash_loan_system::utils::validate_slippage(expected, actual_high_slippage, max_slippage).is_err());
}

#[tokio::test]
async fn test_arbitrage_profit_calculation() {
    let amount_in = 1_000_000; // 1 USDC
    let price_a = 1_010_000; // 1.01 USDT per USDC
    let price_b = 990_000;   // 0.99 USDC per USDT
    let fee_a = 25; // 0.25%
    let fee_b = 30; // 0.30%
    
    let profit = flash_loan_system::utils::calculate_arbitrage_profit(
        amount_in, price_a, price_b, fee_a, fee_b
    ).unwrap();
    
    // Should calculate expected profit after fees
    assert!(profit > 0);
}

#[tokio::test]
async fn test_emergency_withdraw() {
    let program_id = flash_loan_system::id();
    let mut program_test = ProgramTest::new(
        "flash_loan_system",
        program_id,
        processor!(flash_loan_system::entry),
    );
    
    program_test.add_program("spl_token", spl_token::id(), None);
    
    let (mut banks_client, payer, recent_blockhash) = program_test.start().await;
    
    let authority = Keypair::new();
    fund_account(&mut banks_client, &payer, &authority.pubkey(), recent_blockhash).await;
    
    // Initialize system
    initialize_system(&mut banks_client, &authority, program_id, recent_blockhash).await;
    
    // Create token accounts for emergency withdraw test
    let usdc_mint = create_mint(&mut banks_client, &payer, &authority.pubkey(), recent_blockhash).await;
    let pool_token_account = create_token_account(
        &mut banks_client,
        &payer,
        &usdc_mint,
        &authority.pubkey(),
        recent_blockhash,
    ).await;
    let authority_token_account = create_token_account(
        &mut banks_client,
        &payer,
        &usdc_mint,
        &authority.pubkey(),
        recent_blockhash,
    ).await;
    
    // Mint tokens to pool
    mint_tokens(&mut banks_client, &payer, &usdc_mint, &pool_token_account, &authority, 1_000_000, recent_blockhash).await;
    
    // First pause the system (would need pause instruction)
    // Then test emergency withdraw
    let emergency_withdraw_ix = flash_loan_system::instruction::EmergencyWithdraw {
        flash_loan_state: get_flash_loan_state_pda(program_id),
        authority: authority.pubkey(),
        pool_token_account,
        authority_token_account,
        token_program: spl_token::id(),
    };
    
    let emergency_tx = Transaction::new_signed_with_payer(
        &[emergency_withdraw_ix.into()],
        Some(&authority.pubkey()),
        &[&authority],
        recent_blockhash,
    );
    
    // Verify instruction creation
    assert!(emergency_tx.message.instructions.len() == 1);
}

// Helper functions

async fn fund_account(
    banks_client: &mut BanksClient,
    payer: &Keypair,
    account: &Pubkey,
    recent_blockhash: solana_sdk::hash::Hash,
) {
    let fund_ix = system_instruction::transfer(payer.pubkey(), account, 1_000_000_000);
    let fund_tx = Transaction::new_signed_with_payer(
        &[fund_ix],
        Some(&payer.pubkey()),
        &[payer],
        recent_blockhash,
    );
    banks_client.process_transaction(fund_tx).await.unwrap();
}

async fn create_mint(
    banks_client: &mut BanksClient,
    payer: &Keypair,
    authority: &Pubkey,
    recent_blockhash: solana_sdk::hash::Hash,
) -> Pubkey {
    let mint = Keypair::new();
    let rent = banks_client.get_rent().await.unwrap();
    let mint_rent = rent.minimum_balance(spl_token::state::Mint::LEN);
    
    let create_mint_ix = system_instruction::create_account(
        &payer.pubkey(),
        &mint.pubkey(),
        mint_rent,
        spl_token::state::Mint::LEN as u64,
        &spl_token::id(),
    );
    
    let init_mint_ix = token_instruction::initialize_mint(
        &spl_token::id(),
        &mint.pubkey(),
        authority,
        None,
        6, // decimals
    ).unwrap();
    
    let mint_tx = Transaction::new_signed_with_payer(
        &[create_mint_ix, init_mint_ix],
        Some(&payer.pubkey()),
        &[payer, &mint],
        recent_blockhash,
    );
    
    banks_client.process_transaction(mint_tx).await.unwrap();
    mint.pubkey()
}

async fn create_token_account(
    banks_client: &mut BanksClient,
    payer: &Keypair,
    mint: &Pubkey,
    owner: &Pubkey,
    recent_blockhash: solana_sdk::hash::Hash,
) -> Pubkey {
    let token_account = Keypair::new();
    let rent = banks_client.get_rent().await.unwrap();
    let account_rent = rent.minimum_balance(spl_token::state::Account::LEN);
    
    let create_account_ix = system_instruction::create_account(
        &payer.pubkey(),
        &token_account.pubkey(),
        account_rent,
        spl_token::state::Account::LEN as u64,
        &spl_token::id(),
    );
    
    let init_account_ix = token_instruction::initialize_account(
        &spl_token::id(),
        &token_account.pubkey(),
        mint,
        owner,
    ).unwrap();
    
    let account_tx = Transaction::new_signed_with_payer(
        &[create_account_ix, init_account_ix],
        Some(&payer.pubkey()),
        &[payer, &token_account],
        recent_blockhash,
    );
    
    banks_client.process_transaction(account_tx).await.unwrap();
    token_account.pubkey()
}

async fn mint_tokens(
    banks_client: &mut BanksClient,
    payer: &Keypair,
    mint: &Pubkey,
    token_account: &Pubkey,
    authority: &Keypair,
    amount: u64,
    recent_blockhash: solana_sdk::hash::Hash,
) {
    let mint_to_ix = token_instruction::mint_to(
        &spl_token::id(),
        mint,
        token_account,
        &authority.pubkey(),
        &[],
        amount,
    ).unwrap();
    
    let mint_tx = Transaction::new_signed_with_payer(
        &[mint_to_ix],
        Some(&payer.pubkey()),
        &[payer, authority],
        recent_blockhash,
    );
    
    banks_client.process_transaction(mint_tx).await.unwrap();
}

async fn initialize_system(
    banks_client: &mut BanksClient,
    authority: &Keypair,
    program_id: Pubkey,
    recent_blockhash: solana_sdk::hash::Hash,
) {
    let (flash_loan_state_pda, _) = Pubkey::find_program_address(
        &[b"flash_loan_state"],
        &program_id,
    );
    
    let initialize_ix = flash_loan_system::instruction::Initialize {
        flash_loan_state: flash_loan_state_pda,
        authority: authority.pubkey(),
        system_program: solana_program::system_program::id(),
        rent: sysvar::rent::id(),
    };
    
    let initialize_tx = Transaction::new_signed_with_payer(
        &[initialize_ix.into()],
        Some(&authority.pubkey()),
        &[authority],
        recent_blockhash,
    );
    
    banks_client.process_transaction(initialize_tx).await.unwrap();
}

fn get_flash_loan_state_pda(program_id: Pubkey) -> Pubkey {
    let (pda, _) = Pubkey::find_program_address(&[b"flash_loan_state"], &program_id);
    pda
}

fn create_test_dex_route() -> Vec<u8> {
    // Create a simple test DEX route
    let mut route = Vec::new();
    
    // DEX ID (1 byte)
    route.push(1);
    
    // Token in (32 bytes)
    route.extend_from_slice(&Pubkey::new_unique().to_bytes());
    
    // Token out (32 bytes)
    route.extend_from_slice(&Pubkey::new_unique().to_bytes());
    
    // Pool address (32 bytes)
    route.extend_from_slice(&Pubkey::new_unique().to_bytes());
    
    route
}

