#!/usr/bin/env node

/**
 * LimitlessFlashBot Smoke Test
 * Verifies that the deployment is working correctly
 */

const { ethers } = require('ethers');
const axios = require('axios');

// Configuration from environment variables
const CONFIG = {
  CONTRACT_ADDRESS: process.env.CONTRACT_ADDRESS,
  EXECUTOR_API_URL: process.env.EXECUTOR_API_URL || 'http://localhost:3000',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',
  PRIVATE_KEY: process.env.PRIVATE_KEY,
  RPC_URL: process.env.QUICKNODE_RPC || process.env.INFURA_RPC || process.env.ALCHEMY_RPC,
  PROFIT_WALLET: process.env.PROFIT_WALLET || '0xDe32ebF443f213E6b904461FfBE3e107b93CE3Bc'
};

// Test results
const results = {
  passed: 0,
  failed: 0,
  tests: []
};

// Utility functions
const log = {
  info: (msg) => console.log(`ℹ️  ${msg}`),
  success: (msg) => console.log(`✅ ${msg}`),
  error: (msg) => console.log(`❌ ${msg}`),
  warn: (msg) => console.log(`⚠️  ${msg}`)
};

const test = async (name, testFn) => {
  try {
    log.info(`Running test: ${name}`);
    await testFn();
    results.passed++;
    results.tests.push({ name, status: 'PASSED' });
    log.success(`Test passed: ${name}`);
  } catch (error) {
    results.failed++;
    results.tests.push({ name, status: 'FAILED', error: error.message });
    log.error(`Test failed: ${name} - ${error.message}`);
  }
};

// Test functions
const testContractDeployment = async () => {
  if (!CONFIG.CONTRACT_ADDRESS || !CONFIG.RPC_URL) {
    throw new Error('CONTRACT_ADDRESS and RPC_URL are required');
  }

  const provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_URL);
  const code = await provider.getCode(CONFIG.CONTRACT_ADDRESS);
  
  if (code === '0x') {
    throw new Error('Contract not deployed or invalid address');
  }
  
  log.info(`Contract deployed at: ${CONFIG.CONTRACT_ADDRESS}`);
  log.info(`Contract code size: ${code.length} bytes`);
};

const testContractOwnership = async () => {
  if (!CONFIG.CONTRACT_ADDRESS || !CONFIG.RPC_URL || !CONFIG.PRIVATE_KEY) {
    throw new Error('CONTRACT_ADDRESS, RPC_URL, and PRIVATE_KEY are required');
  }

  const provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_URL);
  const wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY, provider);
  
  // Simple ABI for owner function
  const abi = ['function owner() view returns (address)'];
  const contract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, abi, wallet);
  
  const owner = await contract.owner();
  log.info(`Contract owner: ${owner}`);
  log.info(`Wallet address: ${wallet.address}`);
  
  if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
    log.warn('Wallet is not the contract owner');
  }
};

const testContractProfitWallet = async () => {
  if (!CONFIG.CONTRACT_ADDRESS || !CONFIG.RPC_URL) {
    throw new Error('CONTRACT_ADDRESS and RPC_URL are required');
  }

  const provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_URL);
  
  // Simple ABI for profitWallet function
  const abi = ['function profitWallet() view returns (address)'];
  const contract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, abi, provider);
  
  const profitWallet = await contract.profitWallet();
  log.info(`Profit wallet: ${profitWallet}`);
  
  if (profitWallet.toLowerCase() !== CONFIG.PROFIT_WALLET.toLowerCase()) {
    throw new Error(`Profit wallet mismatch. Expected: ${CONFIG.PROFIT_WALLET}, Got: ${profitWallet}`);
  }
};

const testExecutorAPI = async () => {
  try {
    const response = await axios.get(`${CONFIG.EXECUTOR_API_URL}/health`, {
      timeout: 10000
    });
    
    if (response.status !== 200) {
      throw new Error(`Health check failed with status: ${response.status}`);
    }
    
    log.info(`Executor API health: ${JSON.stringify(response.data)}`);
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      throw new Error('Executor API is not running or not accessible');
    }
    throw error;
  }
};

const testExecutorStats = async () => {
  try {
    const response = await axios.get(`${CONFIG.EXECUTOR_API_URL}/stats`, {
      timeout: 10000
    });
    
    if (response.status !== 200) {
      throw new Error(`Stats endpoint failed with status: ${response.status}`);
    }
    
    log.info(`Executor stats: ${JSON.stringify(response.data)}`);
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      throw new Error('Executor API is not running or not accessible');
    }
    // Stats endpoint might not be implemented yet, so we'll warn instead of fail
    log.warn(`Stats endpoint not available: ${error.message}`);
  }
};

const testFrontendAccess = async () => {
  try {
    const response = await axios.get(CONFIG.FRONTEND_URL, {
      timeout: 10000,
      headers: {
        'User-Agent': 'LimitlessFlashBot-SmokeTest/1.0'
      }
    });
    
    if (response.status !== 200) {
      throw new Error(`Frontend not accessible, status: ${response.status}`);
    }
    
    if (!response.data.includes('LimitlessFlashBot')) {
      throw new Error('Frontend content does not contain expected title');
    }
    
    log.info('Frontend is accessible and contains expected content');
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      throw new Error('Frontend is not running or not accessible');
    }
    throw error;
  }
};

const testNetworkConnectivity = async () => {
  if (!CONFIG.RPC_URL) {
    throw new Error('RPC_URL is required');
  }

  const provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_URL);
  
  const blockNumber = await provider.getBlockNumber();
  const network = await provider.getNetwork();
  
  log.info(`Connected to network: ${network.name} (${network.chainId})`);
  log.info(`Current block number: ${blockNumber}`);
  
  if (network.chainId !== 1) {
    log.warn(`Not connected to mainnet (chainId: ${network.chainId})`);
  }
  
  if (blockNumber < 18000000) {
    throw new Error('Block number seems too low, check RPC connection');
  }
};

const testWalletBalance = async () => {
  if (!CONFIG.PRIVATE_KEY || !CONFIG.RPC_URL) {
    throw new Error('PRIVATE_KEY and RPC_URL are required');
  }

  const provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_URL);
  const wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY, provider);
  
  const balance = await wallet.getBalance();
  const balanceEth = ethers.utils.formatEther(balance);
  
  log.info(`Wallet balance: ${balanceEth} ETH`);
  
  if (parseFloat(balanceEth) < 0.01) {
    log.warn('Wallet balance is very low, may not be sufficient for gas fees');
  }
};

const testFlashbotsConnection = async () => {
  try {
    // Test Flashbots relay connection
    const response = await axios.post('https://relay.flashbots.net', {
      jsonrpc: '2.0',
      method: 'eth_blockNumber',
      params: [],
      id: 1
    }, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (response.data && response.data.result) {
      log.info(`Flashbots relay accessible, block: ${parseInt(response.data.result, 16)}`);
    } else {
      throw new Error('Invalid response from Flashbots relay');
    }
  } catch (error) {
    log.warn(`Flashbots relay test failed: ${error.message}`);
    // Don't fail the entire test suite for this
  }
};

// Main test runner
const runSmokeTests = async () => {
  log.info('🚀 Starting LimitlessFlashBot Smoke Tests...');
  log.info('='.repeat(50));
  
  // Configuration check
  log.info('Configuration:');
  log.info(`- Contract Address: ${CONFIG.CONTRACT_ADDRESS || 'NOT SET'}`);
  log.info(`- Executor API URL: ${CONFIG.EXECUTOR_API_URL}`);
  log.info(`- Frontend URL: ${CONFIG.FRONTEND_URL}`);
  log.info(`- RPC URL: ${CONFIG.RPC_URL ? 'SET' : 'NOT SET'}`);
  log.info(`- Private Key: ${CONFIG.PRIVATE_KEY ? 'SET' : 'NOT SET'}`);
  log.info(`- Profit Wallet: ${CONFIG.PROFIT_WALLET}`);
  log.info('');
  
  // Run tests
  await test('Network Connectivity', testNetworkConnectivity);
  await test('Contract Deployment', testContractDeployment);
  await test('Contract Ownership', testContractOwnership);
  await test('Contract Profit Wallet', testContractProfitWallet);
  await test('Wallet Balance', testWalletBalance);
  await test('Executor API Health', testExecutorAPI);
  await test('Executor API Stats', testExecutorStats);
  await test('Frontend Access', testFrontendAccess);
  await test('Flashbots Connection', testFlashbotsConnection);
  
  // Results summary
  log.info('='.repeat(50));
  log.info('📊 Test Results Summary:');
  log.info(`✅ Passed: ${results.passed}`);
  log.info(`❌ Failed: ${results.failed}`);
  log.info(`📝 Total: ${results.tests.length}`);
  
  if (results.failed > 0) {
    log.info('');
    log.info('Failed Tests:');
    results.tests
      .filter(test => test.status === 'FAILED')
      .forEach(test => {
        log.error(`- ${test.name}: ${test.error}`);
      });
  }
  
  log.info('='.repeat(50));
  
  if (results.failed === 0) {
    log.success('🎉 All smoke tests passed! Deployment is healthy.');
    process.exit(0);
  } else {
    log.error(`💥 ${results.failed} test(s) failed. Please check the deployment.`);
    process.exit(1);
  }
};

// Handle uncaught errors
process.on('unhandledRejection', (error) => {
  log.error(`Unhandled rejection: ${error.message}`);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  log.error(`Uncaught exception: ${error.message}`);
  process.exit(1);
});

// Run the tests
if (require.main === module) {
  runSmokeTests().catch((error) => {
    log.error(`Smoke test runner failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  runSmokeTests,
  test,
  CONFIG
};

