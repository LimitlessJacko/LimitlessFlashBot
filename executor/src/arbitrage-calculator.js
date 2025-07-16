const { ethers } = require('ethers');

/**
 * ArbitrageCalculator
 * Calculates arbitrage opportunities across different DEXes
 */
class ArbitrageCalculator {
  constructor(provider, logger) {
    this.provider = provider;
    this.logger = logger;
    
    // DEX Router addresses
    this.routers = {
      UNISWAP_V2: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
      SUSHISWAP: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
      UNISWAP_V3: '0xE592427A0AEce92De3Edee1F18E0157C05861564'
    };

    // Token addresses
    this.tokens = {
      WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      USDC: '0xA0b86a33E6441E6C5E6c7c8b0E0c4B5c5c5c5c5c',
      USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'
    };

    // Router contracts
    this.routerContracts = {};
    this.initializeRouterContracts();
  }

  initializeRouterContracts() {
    const uniswapV2ABI = [
      'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
      'function getAmountsIn(uint amountOut, address[] calldata path) external view returns (uint[] memory amounts)'
    ];

    this.routerContracts.UNISWAP_V2 = new ethers.Contract(
      this.routers.UNISWAP_V2,
      uniswapV2ABI,
      this.provider
    );

    this.routerContracts.SUSHISWAP = new ethers.Contract(
      this.routers.SUSHISWAP,
      uniswapV2ABI,
      this.provider
    );

    // Uniswap V3 has different interface
    const uniswapV3ABI = [
      'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut)'
    ];

    this.routerContracts.UNISWAP_V3 = new ethers.Contract(
      this.routers.UNISWAP_V3,
      uniswapV3ABI,
      this.provider
    );
  }

  /**
   * Find arbitrage opportunity for a given token pair
   */
  async findArbitrageOpportunity(pair) {
    try {
      const { token0, token1 } = pair;
      const token0Address = this.tokens[token0];
      const token1Address = this.tokens[token1];

      if (!token0Address || !token1Address) {
        throw new Error(`Unsupported token pair: ${token0}/${token1}`);
      }

      // Test different amounts to find optimal arbitrage size
      const testAmounts = [
        ethers.utils.parseEther('1'),
        ethers.utils.parseEther('5'),
        ethers.utils.parseEther('10'),
        ethers.utils.parseEther('50'),
        ethers.utils.parseEther('100')
      ];

      let bestOpportunity = null;
      let maxProfit = ethers.BigNumber.from(0);

      for (const amount of testAmounts) {
        const opportunity = await this.calculateArbitrageProfit(
          token0Address,
          token1Address,
          amount
        );

        if (opportunity && opportunity.profit.gt(maxProfit)) {
          maxProfit = opportunity.profit;
          bestOpportunity = opportunity;
        }
      }

      if (bestOpportunity && maxProfit.gt(ethers.utils.parseEther('0.001'))) {
        this.logger.debug(`Found arbitrage opportunity: ${token0}/${token1}`, {
          profit: ethers.utils.formatEther(maxProfit),
          amount: ethers.utils.formatEther(bestOpportunity.amount)
        });

        return {
          token0,
          token1,
          asset: token0Address,
          amount: bestOpportunity.amount,
          estimatedProfit: maxProfit,
          profitability: parseFloat(ethers.utils.formatEther(maxProfit)),
          path1: bestOpportunity.path1,
          path2: bestOpportunity.path2,
          router1: bestOpportunity.router1,
          router2: bestOpportunity.router2,
          minProfit: maxProfit.mul(95).div(100), // 5% slippage tolerance
          timestamp: Date.now()
        };
      }

      return null;
    } catch (error) {
      this.logger.error(`Error finding arbitrage for ${pair.token0}/${pair.token1}:`, error);
      return null;
    }
  }

  /**
   * Calculate arbitrage profit for specific tokens and amount
   */
  async calculateArbitrageProfit(token0, token1, amount) {
    try {
      // Get prices from different DEXes
      const prices = await Promise.all([
        this.getPrice(token0, token1, amount, 'UNISWAP_V2'),
        this.getPrice(token0, token1, amount, 'SUSHISWAP'),
        this.getPrice(token1, token0, amount, 'UNISWAP_V2'),
        this.getPrice(token1, token0, amount, 'SUSHISWAP')
      ]);

      const [
        uniV2_0to1,
        sushi_0to1,
        uniV2_1to0,
        sushi_1to0
      ] = prices;

      // Find best arbitrage path
      const opportunities = [];

      // Path 1: Buy on Uniswap V2, sell on Sushiswap
      if (uniV2_0to1 && sushi_1to0) {
        const intermediateAmount = uniV2_0to1.amountOut;
        const finalAmount = await this.getAmountOut(token1, token0, intermediateAmount, 'SUSHISWAP');
        
        if (finalAmount && finalAmount.gt(amount)) {
          opportunities.push({
            profit: finalAmount.sub(amount),
            amount,
            path1: [token0, token1],
            path2: [token1, token0],
            router1: this.routers.UNISWAP_V2,
            router2: this.routers.SUSHISWAP,
            type: 'UNI_V2 -> SUSHI'
          });
        }
      }

      // Path 2: Buy on Sushiswap, sell on Uniswap V2
      if (sushi_0to1 && uniV2_1to0) {
        const intermediateAmount = sushi_0to1.amountOut;
        const finalAmount = await this.getAmountOut(token1, token0, intermediateAmount, 'UNISWAP_V2');
        
        if (finalAmount && finalAmount.gt(amount)) {
          opportunities.push({
            profit: finalAmount.sub(amount),
            amount,
            path1: [token0, token1],
            path2: [token1, token0],
            router1: this.routers.SUSHISWAP,
            router2: this.routers.UNISWAP_V2,
            type: 'SUSHI -> UNI_V2'
          });
        }
      }

      // Return best opportunity
      if (opportunities.length > 0) {
        return opportunities.reduce((best, current) => 
          current.profit.gt(best.profit) ? current : best
        );
      }

      return null;
    } catch (error) {
      this.logger.error('Error calculating arbitrage profit:', error);
      return null;
    }
  }

  /**
   * Get price from specific DEX
   */
  async getPrice(tokenIn, tokenOut, amountIn, dex) {
    try {
      const path = [tokenIn, tokenOut];
      const amountOut = await this.getAmountOut(tokenIn, tokenOut, amountIn, dex);
      
      if (amountOut) {
        return {
          amountIn,
          amountOut,
          price: amountOut.mul(ethers.utils.parseEther('1')).div(amountIn),
          dex
        };
      }
      
      return null;
    } catch (error) {
      this.logger.debug(`Error getting price from ${dex}:`, error.message);
      return null;
    }
  }

  /**
   * Get amount out from specific router
   */
  async getAmountOut(tokenIn, tokenOut, amountIn, dex) {
    try {
      const router = this.routerContracts[dex];
      if (!router) {
        throw new Error(`Unsupported DEX: ${dex}`);
      }

      if (dex === 'UNISWAP_V3') {
        // Uniswap V3 requires different approach
        // For simplicity, we'll use a static fee tier of 0.3%
        // In production, you'd want to check multiple fee tiers
        return null; // Simplified for this example
      } else {
        // Uniswap V2 style routers
        const path = [tokenIn, tokenOut];
        const amounts = await router.getAmountsOut(amountIn, path);
        return amounts[amounts.length - 1];
      }
    } catch (error) {
      this.logger.debug(`Error getting amount out from ${dex}:`, error.message);
      return null;
    }
  }

  /**
   * Calculate gas costs for arbitrage transaction
   */
  async calculateGasCosts() {
    try {
      const gasPrice = await this.provider.getGasPrice();
      const estimatedGas = ethers.BigNumber.from('300000'); // Estimated gas for flash loan arbitrage
      
      return gasPrice.mul(estimatedGas);
    } catch (error) {
      this.logger.error('Error calculating gas costs:', error);
      return ethers.utils.parseEther('0.01'); // Fallback estimate
    }
  }

  /**
   * Validate arbitrage opportunity
   */
  async validateOpportunity(opportunity) {
    try {
      // Check if tokens are still supported
      const gasCost = await this.calculateGasCosts();
      const netProfit = opportunity.estimatedProfit.sub(gasCost);
      
      // Must be profitable after gas costs
      if (netProfit.lte(0)) {
        return false;
      }

      // Check if opportunity is still valid (prices haven't changed significantly)
      const currentOpportunity = await this.calculateArbitrageProfit(
        opportunity.asset,
        opportunity.path1[1],
        opportunity.amount
      );

      if (!currentOpportunity) {
        return false;
      }

      // Allow 5% price movement tolerance
      const priceTolerance = opportunity.estimatedProfit.mul(5).div(100);
      const priceDifference = opportunity.estimatedProfit.sub(currentOpportunity.profit).abs();
      
      return priceDifference.lte(priceTolerance);
    } catch (error) {
      this.logger.error('Error validating opportunity:', error);
      return false;
    }
  }

  /**
   * Get optimal arbitrage amount based on available liquidity
   */
  async getOptimalAmount(token, maxLiquidityPercentage = 90) {
    try {
      // This would need to be implemented based on specific DEX liquidity
      // For now, return a conservative amount
      return ethers.utils.parseEther('10');
    } catch (error) {
      this.logger.error('Error getting optimal amount:', error);
      return ethers.utils.parseEther('1');
    }
  }
}

module.exports = ArbitrageCalculator;

