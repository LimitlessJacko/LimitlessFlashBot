const { ethers } = require('ethers');
const axios = require('axios');

/**
 * PriceMonitor
 * Monitors token prices across different DEXes and external sources
 */
class PriceMonitor {
  constructor(provider, logger) {
    this.provider = provider;
    this.logger = logger;
    this.prices = new Map();
    this.priceHistory = new Map();
    this.lastUpdate = null;
    this.updateInterval = 1000; // 1 second
    
    // Token addresses
    this.tokens = {
      WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      USDC: '0xA0b86a33E6441E6C5E6c7c8b0E0c4B5c5c5c5c5c',
      USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'
    };

    // DEX factory addresses for price fetching
    this.dexFactories = {
      UNISWAP_V2: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
      SUSHISWAP: '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac'
    };

    this.initializePriceMonitor();
  }

  async initializePriceMonitor() {
    try {
      this.logger.info('📊 Initializing Price Monitor...');
      
      // Initialize price storage for all tokens
      for (const [symbol, address] of Object.entries(this.tokens)) {
        this.prices.set(symbol, {
          address,
          usd: 0,
          eth: 0,
          lastUpdate: null,
          sources: {}
        });
        this.priceHistory.set(symbol, []);
      }

      // Initial price fetch
      await this.updatePrices();
      
      this.logger.info('✅ Price Monitor initialized successfully');
    } catch (error) {
      this.logger.error('❌ Failed to initialize Price Monitor:', error);
    }
  }

  /**
   * Update all token prices from multiple sources
   */
  async updatePrices() {
    try {
      const updatePromises = [];

      // Update prices from external APIs
      updatePromises.push(this.updatePricesFromCoingecko());
      updatePromises.push(this.updatePricesFromDEXes());

      await Promise.allSettled(updatePromises);
      
      this.lastUpdate = new Date();
      this.logger.debug('📊 Prices updated successfully');
    } catch (error) {
      this.logger.error('Error updating prices:', error);
    }
  }

  /**
   * Update prices from CoinGecko API
   */
  async updatePricesFromCoingecko() {
    try {
      const tokenIds = {
        WETH: 'ethereum',
        DAI: 'dai',
        USDC: 'usd-coin',
        USDT: 'tether',
        WBTC: 'wrapped-bitcoin'
      };

      const ids = Object.values(tokenIds).join(',');
      const response = await axios.get(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd,eth`,
        { timeout: 5000 }
      );

      for (const [symbol, coinId] of Object.entries(tokenIds)) {
        if (response.data[coinId]) {
          const price = this.prices.get(symbol);
          if (price) {
            price.usd = response.data[coinId].usd || 0;
            price.eth = response.data[coinId].eth || 0;
            price.sources.coingecko = {
              usd: response.data[coinId].usd,
              eth: response.data[coinId].eth,
              timestamp: Date.now()
            };
            price.lastUpdate = new Date();
          }
        }
      }

      this.logger.debug('✅ CoinGecko prices updated');
    } catch (error) {
      this.logger.debug('CoinGecko price update failed:', error.message);
    }
  }

  /**
   * Update prices from DEXes
   */
  async updatePricesFromDEXes() {
    try {
      const pairs = [
        { token0: 'WETH', token1: 'DAI' },
        { token0: 'WETH', token1: 'USDC' },
        { token0: 'WETH', token1: 'USDT' },
        { token0: 'WETH', token1: 'WBTC' }
      ];

      for (const pair of pairs) {
        await this.updatePairPriceFromDEX(pair.token0, pair.token1);
      }

      this.logger.debug('✅ DEX prices updated');
    } catch (error) {
      this.logger.debug('DEX price update failed:', error.message);
    }
  }

  /**
   * Update price for a specific pair from DEX
   */
  async updatePairPriceFromDEX(token0Symbol, token1Symbol) {
    try {
      const token0 = this.tokens[token0Symbol];
      const token1 = this.tokens[token1Symbol];

      if (!token0 || !token1) return;

      // Get price from Uniswap V2
      const uniV2Price = await this.getPriceFromUniswapV2(token0, token1);
      if (uniV2Price) {
        const price0 = this.prices.get(token0Symbol);
        const price1 = this.prices.get(token1Symbol);
        
        if (price0 && price1) {
          price0.sources.uniswap_v2 = price0.sources.uniswap_v2 || {};
          price0.sources.uniswap_v2[token1Symbol] = uniV2Price;
          
          price1.sources.uniswap_v2 = price1.sources.uniswap_v2 || {};
          price1.sources.uniswap_v2[token0Symbol] = 1 / uniV2Price;
        }
      }

      // Get price from SushiSwap
      const sushiPrice = await this.getPriceFromSushiSwap(token0, token1);
      if (sushiPrice) {
        const price0 = this.prices.get(token0Symbol);
        const price1 = this.prices.get(token1Symbol);
        
        if (price0 && price1) {
          price0.sources.sushiswap = price0.sources.sushiswap || {};
          price0.sources.sushiswap[token1Symbol] = sushiPrice;
          
          price1.sources.sushiswap = price1.sources.sushiswap || {};
          price1.sources.sushiswap[token0Symbol] = 1 / sushiPrice;
        }
      }
    } catch (error) {
      this.logger.debug(`Error updating pair ${token0Symbol}/${token1Symbol}:`, error.message);
    }
  }

  /**
   * Get price from Uniswap V2
   */
  async getPriceFromUniswapV2(token0, token1) {
    try {
      const factoryABI = [
        'function getPair(address tokenA, address tokenB) external view returns (address pair)'
      ];
      
      const pairABI = [
        'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
        'function token0() external view returns (address)',
        'function token1() external view returns (address)'
      ];

      const factory = new ethers.Contract(
        this.dexFactories.UNISWAP_V2,
        factoryABI,
        this.provider
      );

      const pairAddress = await factory.getPair(token0, token1);
      if (pairAddress === ethers.constants.AddressZero) {
        return null;
      }

      const pair = new ethers.Contract(pairAddress, pairABI, this.provider);
      const reserves = await pair.getReserves();
      const token0Address = await pair.token0();

      let reserve0, reserve1;
      if (token0Address.toLowerCase() === token0.toLowerCase()) {
        reserve0 = reserves.reserve0;
        reserve1 = reserves.reserve1;
      } else {
        reserve0 = reserves.reserve1;
        reserve1 = reserves.reserve0;
      }

      if (reserve0.isZero() || reserve1.isZero()) {
        return null;
      }

      // Price = reserve1 / reserve0
      const price = parseFloat(ethers.utils.formatEther(reserve1)) / 
                   parseFloat(ethers.utils.formatEther(reserve0));

      return price;
    } catch (error) {
      this.logger.debug('Error getting Uniswap V2 price:', error.message);
      return null;
    }
  }

  /**
   * Get price from SushiSwap
   */
  async getPriceFromSushiSwap(token0, token1) {
    try {
      const factoryABI = [
        'function getPair(address tokenA, address tokenB) external view returns (address pair)'
      ];
      
      const pairABI = [
        'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
        'function token0() external view returns (address)',
        'function token1() external view returns (address)'
      ];

      const factory = new ethers.Contract(
        this.dexFactories.SUSHISWAP,
        factoryABI,
        this.provider
      );

      const pairAddress = await factory.getPair(token0, token1);
      if (pairAddress === ethers.constants.AddressZero) {
        return null;
      }

      const pair = new ethers.Contract(pairAddress, pairABI, this.provider);
      const reserves = await pair.getReserves();
      const token0Address = await pair.token0();

      let reserve0, reserve1;
      if (token0Address.toLowerCase() === token0.toLowerCase()) {
        reserve0 = reserves.reserve0;
        reserve1 = reserves.reserve1;
      } else {
        reserve0 = reserves.reserve1;
        reserve1 = reserves.reserve0;
      }

      if (reserve0.isZero() || reserve1.isZero()) {
        return null;
      }

      const price = parseFloat(ethers.utils.formatEther(reserve1)) / 
                   parseFloat(ethers.utils.formatEther(reserve0));

      return price;
    } catch (error) {
      this.logger.debug('Error getting SushiSwap price:', error.message);
      return null;
    }
  }

  /**
   * Get current price for a token
   */
  getPrice(tokenSymbol, currency = 'usd') {
    const price = this.prices.get(tokenSymbol);
    if (!price) return null;

    return {
      symbol: tokenSymbol,
      price: price[currency] || 0,
      lastUpdate: price.lastUpdate,
      sources: price.sources
    };
  }

  /**
   * Get price difference between two DEXes
   */
  getPriceDifference(token0Symbol, token1Symbol, dex1 = 'uniswap_v2', dex2 = 'sushiswap') {
    try {
      const price0 = this.prices.get(token0Symbol);
      if (!price0 || !price0.sources[dex1] || !price0.sources[dex2]) {
        return null;
      }

      const price1 = price0.sources[dex1][token1Symbol];
      const price2 = price0.sources[dex2][token1Symbol];

      if (!price1 || !price2) return null;

      const difference = Math.abs(price1 - price2);
      const percentageDiff = (difference / Math.min(price1, price2)) * 100;

      return {
        token0: token0Symbol,
        token1: token1Symbol,
        dex1,
        dex2,
        price1,
        price2,
        difference,
        percentageDiff,
        arbitrageOpportunity: percentageDiff > 0.1 // 0.1% threshold
      };
    } catch (error) {
      this.logger.error('Error calculating price difference:', error);
      return null;
    }
  }

  /**
   * Get price history for a token
   */
  getPriceHistory(tokenSymbol, limit = 100) {
    const history = this.priceHistory.get(tokenSymbol);
    if (!history) return [];

    return history.slice(-limit);
  }

  /**
   * Add price to history
   */
  addToHistory(tokenSymbol, price) {
    const history = this.priceHistory.get(tokenSymbol) || [];
    
    history.push({
      price,
      timestamp: Date.now()
    });

    // Keep only last 1000 entries
    if (history.length > 1000) {
      history.splice(0, history.length - 1000);
    }

    this.priceHistory.set(tokenSymbol, history);
  }

  /**
   * Calculate price volatility
   */
  calculateVolatility(tokenSymbol, periods = 20) {
    const history = this.getPriceHistory(tokenSymbol, periods);
    if (history.length < 2) return 0;

    const prices = history.map(h => h.price);
    const returns = [];

    for (let i = 1; i < prices.length; i++) {
      const returnValue = (prices[i] - prices[i - 1]) / prices[i - 1];
      returns.push(returnValue);
    }

    if (returns.length === 0) return 0;

    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    
    return Math.sqrt(variance);
  }

  /**
   * Get all current prices
   */
  getAllPrices() {
    const result = {};
    
    for (const [symbol, price] of this.prices.entries()) {
      result[symbol] = {
        address: price.address,
        usd: price.usd,
        eth: price.eth,
        lastUpdate: price.lastUpdate,
        volatility: this.calculateVolatility(symbol)
      };
    }

    return result;
  }

  /**
   * Check if prices are stale
   */
  arePricesStale(maxAge = 60000) { // 1 minute default
    if (!this.lastUpdate) return true;
    return Date.now() - this.lastUpdate.getTime() > maxAge;
  }

  /**
   * Get price monitor status
   */
  getStatus() {
    return {
      lastUpdate: this.lastUpdate,
      totalTokens: this.prices.size,
      stale: this.arePricesStale(),
      updateInterval: this.updateInterval
    };
  }

  /**
   * Force price update
   */
  async forceUpdate() {
    this.logger.info('🔄 Forcing price update...');
    await this.updatePrices();
  }
}

module.exports = PriceMonitor;

