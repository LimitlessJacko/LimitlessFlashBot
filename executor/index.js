#!/usr/bin/env node

/**
 * LimitlessFlashBot Executor
 * Production-grade off-chain executor with quantum-enhanced profit signals
 * Monitors DEX pools, calculates arbitrage opportunities, and executes via Flashbots
 */

const { ethers } = require('ethers');
const { FlashbotsBundleProvider } = require('@flashbots/ethers-provider-bundle');
const Web3 = require('web3');
const axios = require('axios');
const winston = require('winston');
const cron = require('node-cron');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const Sentry = require('@sentry/node');
const TelegramBot = require('telegram-bot-api');

require('dotenv').config({ path: '../.env' });

// Import modules
const ArbitrageCalculator = require('./src/arbitrage-calculator');
const QuantumSignalProcessor = require('./src/quantum-signal-processor');
const FlashbotsExecutor = require('./src/flashbots-executor');
const PriceMonitor = require('./src/price-monitor');
const RiskManager = require('./src/risk-manager');
const DatabaseManager = require('./src/database-manager');

class LimitlessFlashBotExecutor {
  constructor() {
    this.initializeLogging();
    this.initializeMonitoring();
    this.initializeComponents();
    this.initializeWebServer();
    this.isRunning = false;
    this.stats = {
      totalExecutions: 0,
      successfulExecutions: 0,
      totalProfit: ethers.BigNumber.from(0),
      lastExecution: null
    };
  }

  initializeLogging() {
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: { service: 'limitless-flash-bot' },
      transports: [
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/combined.log' }),
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        })
      ]
    });
  }

  initializeMonitoring() {
    // Initialize Sentry for error tracking
    if (process.env.SENTRY_DSN) {
      Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV || 'production'
      });
    }

    // Initialize Telegram bot for alerts
    if (process.env.TELEGRAM_BOT_TOKEN) {
      this.telegramBot = new TelegramBot({
        token: process.env.TELEGRAM_BOT_TOKEN
      });
    }
  }

  async initializeComponents() {
    try {
      this.logger.info('🚀 Initializing LimitlessFlashBot Executor...');

      // Initialize providers
      this.provider = new ethers.providers.JsonRpcProvider(
        process.env.QUICKNODE_RPC || process.env.INFURA_RPC || process.env.ALCHEMY_RPC
      );

      this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.provider);

      // Initialize Flashbots provider
      this.flashbotsProvider = await FlashbotsBundleProvider.create(
        this.provider,
        this.wallet,
        process.env.FLASHBOTS_RPC || 'https://relay.flashbots.net'
      );

      // Initialize contract
      const contractABI = require('./abi/LimitlessFlashBot.json');
      const contractAddress = process.env.CONTRACT_ADDRESS;
      
      if (!contractAddress) {
        throw new Error('CONTRACT_ADDRESS not set in environment variables');
      }

      this.contract = new ethers.Contract(contractAddress, contractABI, this.wallet);

      // Initialize components
      this.arbitrageCalculator = new ArbitrageCalculator(this.provider, this.logger);
      this.quantumProcessor = new QuantumSignalProcessor(this.logger);
      this.flashbotsExecutor = new FlashbotsExecutor(this.flashbotsProvider, this.logger);
      this.priceMonitor = new PriceMonitor(this.provider, this.logger);
      this.riskManager = new RiskManager(this.logger);
      this.databaseManager = new DatabaseManager(this.logger);

      // Initialize database
      await this.databaseManager.initialize();

      this.logger.info('✅ All components initialized successfully');
    } catch (error) {
      this.logger.error('❌ Failed to initialize components:', error);
      throw error;
    }
  }

  initializeWebServer() {
    this.app = express();
    
    // Middleware
    this.app.use(helmet());
    this.app.use(compression());
    this.app.use(cors());
    this.app.use(morgan('combined'));
    this.app.use(express.json());

    // Routes
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        isRunning: this.isRunning,
        stats: {
          ...this.stats,
          totalProfit: this.stats.totalProfit.toString()
        },
        timestamp: new Date().toISOString()
      });
    });

    this.app.get('/stats', (req, res) => {
      res.json({
        ...this.stats,
        totalProfit: this.stats.totalProfit.toString(),
        profitUSD: this.convertToUSD(this.stats.totalProfit),
        timestamp: new Date().toISOString()
      });
    });

    this.app.post('/start', (req, res) => {
      if (!this.isRunning) {
        this.start();
        res.json({ message: 'Bot started successfully' });
      } else {
        res.status(400).json({ error: 'Bot is already running' });
      }
    });

    this.app.post('/stop', (req, res) => {
      if (this.isRunning) {
        this.stop();
        res.json({ message: 'Bot stopped successfully' });
      } else {
        res.status(400).json({ error: 'Bot is not running' });
      }
    });

    this.app.post('/update-model', async (req, res) => {
      try {
        await this.quantumProcessor.updateModel(req.body);
        res.json({ message: 'Model updated successfully' });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    const port = process.env.PORT || 3000;
    this.server = this.app.listen(port, () => {
      this.logger.info(`🌐 Web server running on port ${port}`);
    });
  }

  async start() {
    if (this.isRunning) {
      this.logger.warn('Bot is already running');
      return;
    }

    this.logger.info('🚀 Starting LimitlessFlashBot Executor...');
    this.isRunning = true;

    // Start monitoring
    this.startPriceMonitoring();
    this.startArbitrageScanning();
    this.startHealthChecks();

    // Schedule periodic tasks
    this.schedulePeriodicTasks();

    this.logger.info('✅ LimitlessFlashBot Executor started successfully');
    await this.sendTelegramAlert('🚀 LimitlessFlashBot started successfully');
  }

  async stop() {
    if (!this.isRunning) {
      this.logger.warn('Bot is not running');
      return;
    }

    this.logger.info('🛑 Stopping LimitlessFlashBot Executor...');
    this.isRunning = false;

    // Stop all monitoring
    if (this.priceMonitorInterval) clearInterval(this.priceMonitorInterval);
    if (this.arbitrageScanInterval) clearInterval(this.arbitrageScanInterval);
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);

    this.logger.info('✅ LimitlessFlashBot Executor stopped');
    await this.sendTelegramAlert('🛑 LimitlessFlashBot stopped');
  }

  startPriceMonitoring() {
    this.priceMonitorInterval = setInterval(async () => {
      try {
        await this.priceMonitor.updatePrices();
      } catch (error) {
        this.logger.error('Price monitoring error:', error);
      }
    }, 1000); // Update every second
  }

  startArbitrageScanning() {
    this.arbitrageScanInterval = setInterval(async () => {
      if (!this.isRunning) return;

      try {
        await this.scanForArbitrageOpportunities();
      } catch (error) {
        this.logger.error('Arbitrage scanning error:', error);
        Sentry.captureException(error);
      }
    }, 2000); // Scan every 2 seconds
  }

  startHealthChecks() {
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        this.logger.error('Health check error:', error);
      }
    }, 30000); // Check every 30 seconds
  }

  schedulePeriodicTasks() {
    // Daily profit report
    cron.schedule('0 0 * * *', async () => {
      await this.generateDailyReport();
    });

    // Hourly health check
    cron.schedule('0 * * * *', async () => {
      await this.performDetailedHealthCheck();
    });

    // Update quantum model every 6 hours
    cron.schedule('0 */6 * * *', async () => {
      await this.quantumProcessor.updateModel();
    });
  }

  async scanForArbitrageOpportunities() {
    const supportedPairs = [
      { token0: 'WETH', token1: 'DAI' },
      { token0: 'WETH', token1: 'USDC' },
      { token0: 'WETH', token1: 'USDT' },
      { token0: 'DAI', token1: 'USDC' },
      { token0: 'DAI', token1: 'USDT' },
      { token0: 'USDC', token1: 'USDT' }
    ];

    for (const pair of supportedPairs) {
      try {
        const opportunity = await this.arbitrageCalculator.findArbitrageOpportunity(pair);
        
        if (opportunity && opportunity.profitability > 0) {
          // Get quantum-enhanced signal
          const quantumSignal = await this.quantumProcessor.processSignal(opportunity);
          
          // Apply risk management
          const riskAssessment = await this.riskManager.assessRisk(opportunity);
          
          if (riskAssessment.approved && quantumSignal.confidence > 0.7) {
            await this.executeArbitrage(opportunity, quantumSignal);
          }
        }
      } catch (error) {
        this.logger.error(`Error scanning pair ${pair.token0}/${pair.token1}:`, error);
      }
    }
  }

  async executeArbitrage(opportunity, quantumSignal) {
    try {
      this.logger.info('🎯 Executing arbitrage opportunity:', {
        pair: `${opportunity.token0}/${opportunity.token1}`,
        profit: opportunity.estimatedProfit.toString(),
        confidence: quantumSignal.confidence
      });

      this.stats.totalExecutions++;

      // Prepare transaction parameters
      const params = ethers.utils.defaultAbiCoder.encode(
        ['address[]', 'address[]', 'address', 'address', 'uint256'],
        [
          opportunity.path1,
          opportunity.path2,
          opportunity.router1,
          opportunity.router2,
          opportunity.minProfit
        ]
      );

      // Calculate optimal amount (up to 90% of available liquidity)
      const availableLiquidity = await this.contract.getAvailableLiquidity(opportunity.asset);
      const maxAmount = availableLiquidity.mul(90).div(100);
      const optimalAmount = opportunity.amount.gt(maxAmount) ? maxAmount : opportunity.amount;

      // Create transaction
      const transaction = await this.contract.populateTransaction.executeArbitrage(
        opportunity.asset,
        optimalAmount,
        params
      );

      // Execute via Flashbots
      const result = await this.flashbotsExecutor.executeBundle([transaction]);

      if (result.success) {
        this.stats.successfulExecutions++;
        this.stats.totalProfit = this.stats.totalProfit.add(opportunity.estimatedProfit);
        this.stats.lastExecution = new Date().toISOString();

        // Log to database
        await this.databaseManager.logExecution({
          txHash: result.txHash,
          profit: opportunity.estimatedProfit.toString(),
          asset: opportunity.asset,
          amount: optimalAmount.toString(),
          timestamp: new Date()
        });

        this.logger.info('✅ Arbitrage executed successfully:', {
          txHash: result.txHash,
          profit: opportunity.estimatedProfit.toString()
        });

        await this.sendTelegramAlert(
          `✅ Arbitrage executed! Profit: ${ethers.utils.formatEther(opportunity.estimatedProfit)} ETH`
        );
      } else {
        this.logger.error('❌ Arbitrage execution failed:', result.error);
        await this.sendTelegramAlert(`❌ Arbitrage execution failed: ${result.error}`);
      }
    } catch (error) {
      this.logger.error('❌ Error executing arbitrage:', error);
      Sentry.captureException(error);
      await this.sendTelegramAlert(`❌ Arbitrage error: ${error.message}`);
    }
  }

  async performHealthCheck() {
    try {
      // Check provider connection
      const blockNumber = await this.provider.getBlockNumber();
      
      // Check wallet balance
      const balance = await this.wallet.getBalance();
      
      // Check contract status
      const contractOwner = await this.contract.owner();
      
      const health = {
        blockNumber,
        walletBalance: balance.toString(),
        contractOwner,
        isRunning: this.isRunning,
        timestamp: new Date().toISOString()
      };

      this.logger.debug('Health check passed:', health);

      // Alert if balance is low
      if (balance.lt(ethers.utils.parseEther('0.1'))) {
        await this.sendTelegramAlert(`⚠️ Low wallet balance: ${ethers.utils.formatEther(balance)} ETH`);
      }

      return health;
    } catch (error) {
      this.logger.error('Health check failed:', error);
      await this.sendTelegramAlert(`❌ Health check failed: ${error.message}`);
      throw error;
    }
  }

  async performDetailedHealthCheck() {
    const health = await this.performHealthCheck();
    
    // Additional checks
    const gasPrice = await this.provider.getGasPrice();
    const networkId = await this.provider.getNetwork();
    
    this.logger.info('Detailed health check:', {
      ...health,
      gasPrice: gasPrice.toString(),
      networkId: networkId.chainId
    });
  }

  async generateDailyReport() {
    const report = {
      date: new Date().toISOString().split('T')[0],
      totalExecutions: this.stats.totalExecutions,
      successfulExecutions: this.stats.successfulExecutions,
      successRate: this.stats.totalExecutions > 0 ? 
        (this.stats.successfulExecutions / this.stats.totalExecutions * 100).toFixed(2) + '%' : '0%',
      totalProfit: this.stats.totalProfit.toString(),
      totalProfitETH: ethers.utils.formatEther(this.stats.totalProfit),
      totalProfitUSD: await this.convertToUSD(this.stats.totalProfit)
    };

    this.logger.info('📊 Daily Report:', report);
    
    await this.sendTelegramAlert(
      `📊 Daily Report\\n` +
      `Executions: ${report.totalExecutions}\\n` +
      `Success Rate: ${report.successRate}\\n` +
      `Profit: ${report.totalProfitETH} ETH ($${report.totalProfitUSD})`
    );

    // Save to database
    await this.databaseManager.saveDailyReport(report);
  }

  async convertToUSD(ethAmount) {
    try {
      const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
      const ethPrice = response.data.ethereum.usd;
      return (parseFloat(ethers.utils.formatEther(ethAmount)) * ethPrice).toFixed(2);
    } catch (error) {
      this.logger.error('Error converting to USD:', error);
      return '0.00';
    }
  }

  async sendTelegramAlert(message) {
    if (!this.telegramBot || !process.env.TELEGRAM_CHAT_ID) return;

    try {
      await this.telegramBot.sendMessage({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown'
      });
    } catch (error) {
      this.logger.error('Failed to send Telegram alert:', error);
    }
  }

  async shutdown() {
    this.logger.info('🛑 Shutting down LimitlessFlashBot Executor...');
    
    await this.stop();
    
    if (this.server) {
      this.server.close();
    }
    
    await this.databaseManager.close();
    
    this.logger.info('✅ Shutdown complete');
    process.exit(0);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  if (global.executor) {
    await global.executor.shutdown();
  } else {
    process.exit(0);
  }
});

process.on('SIGTERM', async () => {
  if (global.executor) {
    await global.executor.shutdown();
  } else {
    process.exit(0);
  }
});

// Start the executor
async function main() {
  try {
    global.executor = new LimitlessFlashBotExecutor();
    
    // Auto-start if specified
    if (process.env.AUTO_START === 'true') {
      await global.executor.start();
    }
    
    console.log('🚀 LimitlessFlashBot Executor initialized and ready!');
    console.log('📊 Web interface available at http://localhost:' + (process.env.PORT || 3000));
  } catch (error) {
    console.error('❌ Failed to start executor:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = LimitlessFlashBotExecutor;

