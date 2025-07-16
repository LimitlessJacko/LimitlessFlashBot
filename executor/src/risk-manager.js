const { ethers } = require('ethers');

/**
 * RiskManager
 * Handles risk assessment and management for arbitrage opportunities
 */
class RiskManager {
  constructor(logger) {
    this.logger = logger;
    
    // Risk parameters
    this.riskParams = {
      maxDailyLoss: ethers.utils.parseEther('1'), // 1 ETH max daily loss
      maxSingleTradeLoss: ethers.utils.parseEther('0.1'), // 0.1 ETH max single trade loss
      minProfitThreshold: ethers.utils.parseEther('0.001'), // 0.001 ETH minimum profit
      maxSlippage: 5, // 5% maximum slippage
      maxGasPrice: ethers.utils.parseUnits('100', 'gwei'), // 100 gwei max gas price
      maxLiquidityUtilization: 90, // 90% max liquidity utilization
      cooldownPeriod: 60000, // 1 minute cooldown between trades
      maxConsecutiveFailures: 3, // Max consecutive failures before pause
      volatilityThreshold: 0.1, // 10% volatility threshold
      liquidityThreshold: ethers.utils.parseEther('10') // 10 ETH minimum liquidity
    };

    // Risk tracking
    this.riskState = {
      dailyLoss: ethers.BigNumber.from(0),
      dailyProfit: ethers.BigNumber.from(0),
      consecutiveFailures: 0,
      lastTradeTime: 0,
      totalTrades: 0,
      successfulTrades: 0,
      lastResetTime: Date.now(),
      isPaused: false,
      pauseReason: null
    };

    // Trade history for risk analysis
    this.tradeHistory = [];
    this.maxHistorySize = 1000;
  }

  /**
   * Assess risk for an arbitrage opportunity
   */
  async assessRisk(opportunity) {
    try {
      this.logger.debug('🔍 Assessing risk for opportunity:', {
        profit: ethers.utils.formatEther(opportunity.estimatedProfit),
        amount: ethers.utils.formatEther(opportunity.amount)
      });

      // Reset daily counters if needed
      this.resetDailyCountersIfNeeded();

      // Check if system is paused
      if (this.riskState.isPaused) {
        return {
          approved: false,
          reason: `System paused: ${this.riskState.pauseReason}`,
          riskScore: 1.0
        };
      }

      // Perform risk checks
      const riskChecks = await Promise.all([
        this.checkProfitThreshold(opportunity),
        this.checkDailyLossLimit(opportunity),
        this.checkSingleTradeLossLimit(opportunity),
        this.checkSlippage(opportunity),
        this.checkGasPrice(),
        this.checkLiquidityUtilization(opportunity),
        this.checkCooldownPeriod(),
        this.checkConsecutiveFailures(),
        this.checkVolatility(opportunity),
        this.checkLiquidityThreshold(opportunity)
      ]);

      // Calculate overall risk score
      const riskScore = this.calculateRiskScore(riskChecks);
      
      // Determine if trade is approved
      const approved = riskChecks.every(check => check.passed) && riskScore < 0.7;

      const result = {
        approved,
        riskScore,
        checks: riskChecks,
        reason: approved ? 'Risk assessment passed' : this.getFailureReason(riskChecks)
      };

      this.logger.debug('📊 Risk assessment result:', {
        approved: result.approved,
        riskScore: result.riskScore.toFixed(3),
        reason: result.reason
      });

      return result;
    } catch (error) {
      this.logger.error('❌ Risk assessment failed:', error);
      return {
        approved: false,
        reason: `Risk assessment error: ${error.message}`,
        riskScore: 1.0
      };
    }
  }

  /**
   * Check if profit meets minimum threshold
   */
  async checkProfitThreshold(opportunity) {
    const passed = opportunity.estimatedProfit.gte(this.riskParams.minProfitThreshold);
    
    return {
      name: 'profit_threshold',
      passed,
      value: ethers.utils.formatEther(opportunity.estimatedProfit),
      threshold: ethers.utils.formatEther(this.riskParams.minProfitThreshold),
      weight: 0.2
    };
  }

  /**
   * Check daily loss limit
   */
  async checkDailyLossLimit(opportunity) {
    // Estimate potential loss (gas costs + slippage)
    const estimatedLoss = opportunity.amount.mul(this.riskParams.maxSlippage).div(100);
    const potentialDailyLoss = this.riskState.dailyLoss.add(estimatedLoss);
    const passed = potentialDailyLoss.lte(this.riskParams.maxDailyLoss);
    
    return {
      name: 'daily_loss_limit',
      passed,
      value: ethers.utils.formatEther(potentialDailyLoss),
      threshold: ethers.utils.formatEther(this.riskParams.maxDailyLoss),
      weight: 0.3
    };
  }

  /**
   * Check single trade loss limit
   */
  async checkSingleTradeLossLimit(opportunity) {
    const estimatedLoss = opportunity.amount.mul(this.riskParams.maxSlippage).div(100);
    const passed = estimatedLoss.lte(this.riskParams.maxSingleTradeLoss);
    
    return {
      name: 'single_trade_loss_limit',
      passed,
      value: ethers.utils.formatEther(estimatedLoss),
      threshold: ethers.utils.formatEther(this.riskParams.maxSingleTradeLoss),
      weight: 0.2
    };
  }

  /**
   * Check slippage tolerance
   */
  async checkSlippage(opportunity) {
    // Calculate expected slippage based on liquidity and trade size
    const estimatedSlippage = this.estimateSlippage(opportunity);
    const passed = estimatedSlippage <= this.riskParams.maxSlippage;
    
    return {
      name: 'slippage_check',
      passed,
      value: `${estimatedSlippage.toFixed(2)}%`,
      threshold: `${this.riskParams.maxSlippage}%`,
      weight: 0.15
    };
  }

  /**
   * Check current gas price
   */
  async checkGasPrice() {
    try {
      // This would need access to provider, simplified for now
      const currentGasPrice = ethers.utils.parseUnits('50', 'gwei'); // Mock value
      const passed = currentGasPrice.lte(this.riskParams.maxGasPrice);
      
      return {
        name: 'gas_price_check',
        passed,
        value: ethers.utils.formatUnits(currentGasPrice, 'gwei') + ' gwei',
        threshold: ethers.utils.formatUnits(this.riskParams.maxGasPrice, 'gwei') + ' gwei',
        weight: 0.1
      };
    } catch (error) {
      return {
        name: 'gas_price_check',
        passed: false,
        value: 'unknown',
        threshold: ethers.utils.formatUnits(this.riskParams.maxGasPrice, 'gwei') + ' gwei',
        weight: 0.1
      };
    }
  }

  /**
   * Check liquidity utilization
   */
  async checkLiquidityUtilization(opportunity) {
    // This would need access to actual liquidity data
    const utilizationPercentage = 75; // Mock value
    const passed = utilizationPercentage <= this.riskParams.maxLiquidityUtilization;
    
    return {
      name: 'liquidity_utilization',
      passed,
      value: `${utilizationPercentage}%`,
      threshold: `${this.riskParams.maxLiquidityUtilization}%`,
      weight: 0.1
    };
  }

  /**
   * Check cooldown period
   */
  async checkCooldownPeriod() {
    const timeSinceLastTrade = Date.now() - this.riskState.lastTradeTime;
    const passed = timeSinceLastTrade >= this.riskParams.cooldownPeriod;
    
    return {
      name: 'cooldown_period',
      passed,
      value: `${Math.round(timeSinceLastTrade / 1000)}s`,
      threshold: `${this.riskParams.cooldownPeriod / 1000}s`,
      weight: 0.05
    };
  }

  /**
   * Check consecutive failures
   */
  async checkConsecutiveFailures() {
    const passed = this.riskState.consecutiveFailures < this.riskParams.maxConsecutiveFailures;
    
    return {
      name: 'consecutive_failures',
      passed,
      value: this.riskState.consecutiveFailures.toString(),
      threshold: this.riskParams.maxConsecutiveFailures.toString(),
      weight: 0.2
    };
  }

  /**
   * Check market volatility
   */
  async checkVolatility(opportunity) {
    // This would need access to price monitor
    const volatility = 0.05; // Mock 5% volatility
    const passed = volatility <= this.riskParams.volatilityThreshold;
    
    return {
      name: 'volatility_check',
      passed,
      value: `${(volatility * 100).toFixed(2)}%`,
      threshold: `${(this.riskParams.volatilityThreshold * 100).toFixed(2)}%`,
      weight: 0.15
    };
  }

  /**
   * Check minimum liquidity threshold
   */
  async checkLiquidityThreshold(opportunity) {
    // This would need access to actual liquidity data
    const availableLiquidity = ethers.utils.parseEther('50'); // Mock value
    const passed = availableLiquidity.gte(this.riskParams.liquidityThreshold);
    
    return {
      name: 'liquidity_threshold',
      passed,
      value: ethers.utils.formatEther(availableLiquidity) + ' ETH',
      threshold: ethers.utils.formatEther(this.riskParams.liquidityThreshold) + ' ETH',
      weight: 0.1
    };
  }

  /**
   * Calculate overall risk score
   */
  calculateRiskScore(riskChecks) {
    let totalWeight = 0;
    let weightedScore = 0;

    for (const check of riskChecks) {
      totalWeight += check.weight;
      weightedScore += check.passed ? 0 : check.weight;
    }

    return totalWeight > 0 ? weightedScore / totalWeight : 1.0;
  }

  /**
   * Get failure reason from risk checks
   */
  getFailureReason(riskChecks) {
    const failedChecks = riskChecks.filter(check => !check.passed);
    
    if (failedChecks.length === 0) {
      return 'High risk score';
    }

    const primaryFailure = failedChecks.reduce((prev, current) => 
      prev.weight > current.weight ? prev : current
    );

    return `${primaryFailure.name}: ${primaryFailure.value} exceeds ${primaryFailure.threshold}`;
  }

  /**
   * Estimate slippage for trade
   */
  estimateSlippage(opportunity) {
    // Simplified slippage estimation
    // In production, this would use actual liquidity data
    const baseSlippage = 0.1; // 0.1% base slippage
    const amountETH = parseFloat(ethers.utils.formatEther(opportunity.amount));
    
    // Increase slippage for larger trades
    const sizeMultiplier = Math.min(amountETH / 10, 5); // Cap at 5x
    
    return baseSlippage * (1 + sizeMultiplier);
  }

  /**
   * Record trade result for risk tracking
   */
  recordTradeResult(opportunity, result) {
    try {
      const trade = {
        timestamp: Date.now(),
        opportunity,
        result,
        profit: result.success ? opportunity.estimatedProfit : ethers.BigNumber.from(0),
        loss: result.success ? ethers.BigNumber.from(0) : opportunity.estimatedProfit
      };

      // Add to history
      this.tradeHistory.push(trade);
      if (this.tradeHistory.length > this.maxHistorySize) {
        this.tradeHistory.shift();
      }

      // Update risk state
      this.riskState.totalTrades++;
      this.riskState.lastTradeTime = Date.now();

      if (result.success) {
        this.riskState.successfulTrades++;
        this.riskState.consecutiveFailures = 0;
        this.riskState.dailyProfit = this.riskState.dailyProfit.add(opportunity.estimatedProfit);
      } else {
        this.riskState.consecutiveFailures++;
        this.riskState.dailyLoss = this.riskState.dailyLoss.add(opportunity.estimatedProfit);
        
        // Auto-pause if too many consecutive failures
        if (this.riskState.consecutiveFailures >= this.riskParams.maxConsecutiveFailures) {
          this.pauseSystem(`Too many consecutive failures: ${this.riskState.consecutiveFailures}`);
        }
      }

      this.logger.info('📊 Trade result recorded:', {
        success: result.success,
        consecutiveFailures: this.riskState.consecutiveFailures,
        dailyProfit: ethers.utils.formatEther(this.riskState.dailyProfit),
        dailyLoss: ethers.utils.formatEther(this.riskState.dailyLoss)
      });
    } catch (error) {
      this.logger.error('Error recording trade result:', error);
    }
  }

  /**
   * Pause the system
   */
  pauseSystem(reason) {
    this.riskState.isPaused = true;
    this.riskState.pauseReason = reason;
    this.logger.warn('⏸️ System paused:', reason);
  }

  /**
   * Resume the system
   */
  resumeSystem() {
    this.riskState.isPaused = false;
    this.riskState.pauseReason = null;
    this.riskState.consecutiveFailures = 0;
    this.logger.info('▶️ System resumed');
  }

  /**
   * Reset daily counters if needed
   */
  resetDailyCountersIfNeeded() {
    const now = Date.now();
    const timeSinceReset = now - this.riskState.lastResetTime;
    const oneDayMs = 24 * 60 * 60 * 1000;

    if (timeSinceReset >= oneDayMs) {
      this.riskState.dailyLoss = ethers.BigNumber.from(0);
      this.riskState.dailyProfit = ethers.BigNumber.from(0);
      this.riskState.lastResetTime = now;
      this.logger.info('🔄 Daily risk counters reset');
    }
  }

  /**
   * Update risk parameters
   */
  updateRiskParams(newParams) {
    try {
      this.riskParams = { ...this.riskParams, ...newParams };
      this.logger.info('⚙️ Risk parameters updated:', newParams);
      return { success: true };
    } catch (error) {
      this.logger.error('Error updating risk parameters:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get risk statistics
   */
  getRiskStats() {
    const successRate = this.riskState.totalTrades > 0 ? 
      (this.riskState.successfulTrades / this.riskState.totalTrades * 100).toFixed(2) : '0.00';

    const netProfit = this.riskState.dailyProfit.sub(this.riskState.dailyLoss);

    return {
      ...this.riskState,
      dailyProfit: this.riskState.dailyProfit.toString(),
      dailyLoss: this.riskState.dailyLoss.toString(),
      netProfit: netProfit.toString(),
      successRate: `${successRate}%`,
      tradeHistorySize: this.tradeHistory.length,
      riskParams: this.riskParams
    };
  }

  /**
   * Get recent trade history
   */
  getTradeHistory(limit = 50) {
    return this.tradeHistory.slice(-limit).map(trade => ({
      timestamp: trade.timestamp,
      success: trade.result.success,
      profit: trade.profit.toString(),
      loss: trade.loss.toString(),
      asset: trade.opportunity.asset,
      amount: trade.opportunity.amount.toString()
    }));
  }

  /**
   * Force reset risk state
   */
  resetRiskState() {
    this.riskState = {
      dailyLoss: ethers.BigNumber.from(0),
      dailyProfit: ethers.BigNumber.from(0),
      consecutiveFailures: 0,
      lastTradeTime: 0,
      totalTrades: 0,
      successfulTrades: 0,
      lastResetTime: Date.now(),
      isPaused: false,
      pauseReason: null
    };
    
    this.tradeHistory = [];
    this.logger.info('🔄 Risk state reset');
  }
}

module.exports = RiskManager;

