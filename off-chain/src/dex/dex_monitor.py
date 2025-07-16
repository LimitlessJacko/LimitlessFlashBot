"""
DEX monitoring and polling system for all Solana DEXs
"""

import asyncio
import aiohttp
import json
import logging
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime, timedelta
from dataclasses import dataclass
import numpy as np

from ..core.config import config, DEX_PROGRAM_IDS, TOKEN_ADDRESSES
from ..rpc.quicknode_client import QuickNodeClient

logger = logging.getLogger(__name__)

@dataclass
class PriceData:
    """Price data structure"""
    dex: str
    token_pair: str
    price: float
    volume_24h: float
    liquidity: float
    spread: float
    timestamp: datetime
    
@dataclass
class ArbitrageOpportunity:
    """Arbitrage opportunity structure"""
    token_pair: str
    buy_dex: str
    sell_dex: str
    buy_price: float
    sell_price: float
    profit_percentage: float
    volume_available: float
    estimated_profit: float
    risk_score: float
    timestamp: datetime

class DEXMonitor:
    """Monitor all Solana DEXs for arbitrage opportunities"""
    
    def __init__(self, rpc_client: QuickNodeClient = None):
        self.rpc_client = rpc_client or QuickNodeClient()
        self.session: Optional[aiohttp.ClientSession] = None
        self.price_cache: Dict[str, Dict[str, PriceData]] = {}
        self.arbitrage_opportunities: List[ArbitrageOpportunity] = []
        self.monitoring = False
        
        # DEX-specific configurations
        self.dex_configs = {
            'raydium': {
                'api_url': 'https://api.raydium.io/v2',
                'pools_endpoint': '/sdk/liquidity/mainnet.json',
                'price_endpoint': '/main/price'
            },
            'orca': {
                'api_url': 'https://api.orca.so',
                'pools_endpoint': '/v1/whirlpool/list',
                'price_endpoint': '/v1/price'
            },
            'jupiter': {
                'api_url': 'https://price.jup.ag/v4',
                'price_endpoint': '/price'
            },
            'serum': {
                'program_id': DEX_PROGRAM_IDS['serum'],
                'markets_url': 'https://raw.githubusercontent.com/project-serum/serum-ts/master/packages/serum/src/markets.json'
            }
        }
        
    async def __aenter__(self):
        """Async context manager entry"""
        self.session = aiohttp.ClientSession()
        await self.rpc_client.__aenter__()
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit"""
        if self.session:
            await self.session.close()
        await self.rpc_client.__aexit__(exc_type, exc_val, exc_tb)
        
    async def start_monitoring(self):
        """Start monitoring all DEXs"""
        logger.info("Starting DEX monitoring...")
        self.monitoring = True
        
        # Create monitoring tasks for each DEX
        tasks = []
        for dex_name in config.dex.supported_dexs:
            task = asyncio.create_task(self._monitor_dex(dex_name))
            tasks.append(task)
            
        # Add arbitrage detection task
        arbitrage_task = asyncio.create_task(self._detect_arbitrage_opportunities())
        tasks.append(arbitrage_task)
        
        # Wait for all tasks
        try:
            await asyncio.gather(*tasks)
        except Exception as e:
            logger.error(f"Error in monitoring: {e}")
        finally:
            self.monitoring = False
            
    async def stop_monitoring(self):
        """Stop monitoring"""
        logger.info("Stopping DEX monitoring...")
        self.monitoring = False
        
    async def _monitor_dex(self, dex_name: str):
        """Monitor a specific DEX"""
        while self.monitoring:
            try:
                if dex_name == 'raydium':
                    await self._monitor_raydium()
                elif dex_name == 'orca':
                    await self._monitor_orca()
                elif dex_name == 'jupiter':
                    await self._monitor_jupiter()
                elif dex_name == 'serum':
                    await self._monitor_serum()
                elif dex_name == 'saber':
                    await self._monitor_saber()
                else:
                    await self._monitor_generic_dex(dex_name)
                    
                await asyncio.sleep(config.dex.polling_interval)
                
            except Exception as e:
                logger.error(f"Error monitoring {dex_name}: {e}")
                await asyncio.sleep(5)  # Wait before retrying
                
    async def _monitor_raydium(self):
        """Monitor Raydium DEX"""
        try:
            config_data = self.dex_configs['raydium']
            
            # Get pool data
            pools_url = config_data['api_url'] + config_data['pools_endpoint']
            async with self.session.get(pools_url) as response:
                if response.status == 200:
                    pools_data = await response.json()
                    
                    for pool in pools_data.get('official', []):
                        await self._process_raydium_pool(pool)
                        
        except Exception as e:
            logger.error(f"Error monitoring Raydium: {e}")
            
    async def _process_raydium_pool(self, pool: Dict[str, Any]):
        """Process Raydium pool data"""
        try:
            base_mint = pool.get('baseMint')
            quote_mint = pool.get('quoteMint')
            
            if not base_mint or not quote_mint:
                return
                
            # Get token symbols
            base_symbol = self._get_token_symbol(base_mint)
            quote_symbol = self._get_token_symbol(quote_mint)
            
            if not base_symbol or not quote_symbol:
                return
                
            token_pair = f"{base_symbol}/{quote_symbol}"
            
            # Calculate price and liquidity
            base_reserve = float(pool.get('baseReserve', 0))
            quote_reserve = float(pool.get('quoteReserve', 0))
            
            if base_reserve > 0 and quote_reserve > 0:
                price = quote_reserve / base_reserve
                liquidity = quote_reserve  # Use quote reserve as liquidity measure
                
                # Estimate spread (simplified)
                spread = 0.003  # 0.3% typical for Raydium
                
                price_data = PriceData(
                    dex='raydium',
                    token_pair=token_pair,
                    price=price,
                    volume_24h=float(pool.get('volume24h', 0)),
                    liquidity=liquidity,
                    spread=spread,
                    timestamp=datetime.now()
                )
                
                # Update cache
                if 'raydium' not in self.price_cache:
                    self.price_cache['raydium'] = {}
                self.price_cache['raydium'][token_pair] = price_data
                
        except Exception as e:
            logger.error(f"Error processing Raydium pool: {e}")
            
    async def _monitor_orca(self):
        """Monitor Orca DEX"""
        try:
            config_data = self.dex_configs['orca']
            
            # Get whirlpool data
            pools_url = config_data['api_url'] + config_data['pools_endpoint']
            async with self.session.get(pools_url) as response:
                if response.status == 200:
                    pools_data = await response.json()
                    
                    for pool in pools_data.get('whirlpools', []):
                        await self._process_orca_pool(pool)
                        
        except Exception as e:
            logger.error(f"Error monitoring Orca: {e}")
            
    async def _process_orca_pool(self, pool: Dict[str, Any]):
        """Process Orca pool data"""
        try:
            token_a = pool.get('tokenA', {})
            token_b = pool.get('tokenB', {})
            
            token_a_mint = token_a.get('mint')
            token_b_mint = token_b.get('mint')
            
            if not token_a_mint or not token_b_mint:
                return
                
            # Get token symbols
            token_a_symbol = self._get_token_symbol(token_a_mint)
            token_b_symbol = self._get_token_symbol(token_b_mint)
            
            if not token_a_symbol or not token_b_symbol:
                return
                
            token_pair = f"{token_a_symbol}/{token_b_symbol}"
            
            # Calculate price and liquidity
            liquidity_a = float(pool.get('liquidity', {}).get('tokenA', 0))
            liquidity_b = float(pool.get('liquidity', {}).get('tokenB', 0))
            
            if liquidity_a > 0 and liquidity_b > 0:
                price = liquidity_b / liquidity_a
                total_liquidity = liquidity_b  # Use token B as base
                
                # Get fee tier
                fee_rate = float(pool.get('feeRate', 0.003))  # Default 0.3%
                
                price_data = PriceData(
                    dex='orca',
                    token_pair=token_pair,
                    price=price,
                    volume_24h=float(pool.get('volume24h', 0)),
                    liquidity=total_liquidity,
                    spread=fee_rate,
                    timestamp=datetime.now()
                )
                
                # Update cache
                if 'orca' not in self.price_cache:
                    self.price_cache['orca'] = {}
                self.price_cache['orca'][token_pair] = price_data
                
        except Exception as e:
            logger.error(f"Error processing Orca pool: {e}")
            
    async def _monitor_jupiter(self):
        """Monitor Jupiter aggregator prices"""
        try:
            config_data = self.dex_configs['jupiter']
            
            # Get price data for major tokens
            major_tokens = ['SOL', 'USDC', 'USDT', 'RAY', 'SRM', 'ORCA']
            
            for base_token in major_tokens:
                for quote_token in major_tokens:
                    if base_token != quote_token:
                        await self._get_jupiter_price(base_token, quote_token)
                        
        except Exception as e:
            logger.error(f"Error monitoring Jupiter: {e}")
            
    async def _get_jupiter_price(self, base_token: str, quote_token: str):
        """Get price from Jupiter"""
        try:
            base_mint = TOKEN_ADDRESSES.get(base_token)
            quote_mint = TOKEN_ADDRESSES.get(quote_token)
            
            if not base_mint or not quote_mint:
                return
                
            config_data = self.dex_configs['jupiter']
            price_url = f"{config_data['api_url']}{config_data['price_endpoint']}"
            
            params = {
                'ids': base_mint,
                'vsToken': quote_mint
            }
            
            async with self.session.get(price_url, params=params) as response:
                if response.status == 200:
                    price_data = await response.json()
                    
                    if 'data' in price_data and base_mint in price_data['data']:
                        token_data = price_data['data'][base_mint]
                        price = float(token_data.get('price', 0))
                        
                        if price > 0:
                            token_pair = f"{base_token}/{quote_token}"
                            
                            price_obj = PriceData(
                                dex='jupiter',
                                token_pair=token_pair,
                                price=price,
                                volume_24h=0,  # Jupiter doesn't provide volume
                                liquidity=0,   # Jupiter doesn't provide liquidity
                                spread=0.001,  # Estimated spread
                                timestamp=datetime.now()
                            )
                            
                            # Update cache
                            if 'jupiter' not in self.price_cache:
                                self.price_cache['jupiter'] = {}
                            self.price_cache['jupiter'][token_pair] = price_obj
                            
        except Exception as e:
            logger.error(f"Error getting Jupiter price for {base_token}/{quote_token}: {e}")
            
    async def _monitor_serum(self):
        """Monitor Serum DEX"""
        try:
            # Get Serum markets from on-chain data
            program_id = DEX_PROGRAM_IDS['serum']
            accounts = await self.rpc_client.get_program_accounts(program_id)
            
            for account in accounts[:10]:  # Limit to avoid rate limits
                await self._process_serum_market(account)
                
        except Exception as e:
            logger.error(f"Error monitoring Serum: {e}")
            
    async def _process_serum_market(self, account: Dict[str, Any]):
        """Process Serum market data"""
        try:
            # This is a simplified implementation
            # In production, you would decode the Serum market data properly
            
            account_data = account.get('account', {})
            if not account_data:
                return
                
            # Placeholder for Serum market processing
            # You would need to implement proper Serum market data decoding
            
        except Exception as e:
            logger.error(f"Error processing Serum market: {e}")
            
    async def _monitor_saber(self):
        """Monitor Saber DEX"""
        try:
            # Saber API endpoint
            saber_api = "https://registry.saber.so/data/llama.mainnet.json"
            
            async with self.session.get(saber_api) as response:
                if response.status == 200:
                    pools_data = await response.json()
                    
                    for pool in pools_data.get('pools', []):
                        await self._process_saber_pool(pool)
                        
        except Exception as e:
            logger.error(f"Error monitoring Saber: {e}")
            
    async def _process_saber_pool(self, pool: Dict[str, Any]):
        """Process Saber pool data"""
        try:
            tokens = pool.get('tokens', [])
            if len(tokens) < 2:
                return
                
            token_a = tokens[0]
            token_b = tokens[1]
            
            token_a_symbol = token_a.get('symbol', '')
            token_b_symbol = token_b.get('symbol', '')
            
            if not token_a_symbol or not token_b_symbol:
                return
                
            token_pair = f"{token_a_symbol}/{token_b_symbol}"
            
            # Get reserves
            reserve_a = float(pool.get('reserves', {}).get(token_a.get('mint', ''), 0))
            reserve_b = float(pool.get('reserves', {}).get(token_b.get('mint', ''), 0))
            
            if reserve_a > 0 and reserve_b > 0:
                price = reserve_b / reserve_a
                liquidity = reserve_b
                
                price_data = PriceData(
                    dex='saber',
                    token_pair=token_pair,
                    price=price,
                    volume_24h=float(pool.get('volume24h', 0)),
                    liquidity=liquidity,
                    spread=0.0025,  # 0.25% typical for Saber
                    timestamp=datetime.now()
                )
                
                # Update cache
                if 'saber' not in self.price_cache:
                    self.price_cache['saber'] = {}
                self.price_cache['saber'][token_pair] = price_data
                
        except Exception as e:
            logger.error(f"Error processing Saber pool: {e}")
            
    async def _monitor_generic_dex(self, dex_name: str):
        """Generic DEX monitoring for other DEXs"""
        try:
            # Placeholder for other DEXs
            # Each DEX would need specific implementation
            pass
            
        except Exception as e:
            logger.error(f"Error monitoring {dex_name}: {e}")
            
    async def _detect_arbitrage_opportunities(self):
        """Detect arbitrage opportunities across DEXs"""
        while self.monitoring:
            try:
                current_opportunities = []
                
                # Get all token pairs
                all_pairs = set()
                for dex_data in self.price_cache.values():
                    all_pairs.update(dex_data.keys())
                    
                # Check each pair across DEXs
                for token_pair in all_pairs:
                    opportunity = await self._find_arbitrage_for_pair(token_pair)
                    if opportunity:
                        current_opportunities.append(opportunity)
                        
                # Update opportunities list
                self.arbitrage_opportunities = current_opportunities
                
                # Log significant opportunities
                for opp in current_opportunities:
                    if opp.profit_percentage > 0.01:  # > 1% profit
                        logger.info(f"Arbitrage opportunity: {opp.token_pair} - "
                                  f"Buy on {opp.buy_dex} at {opp.buy_price:.6f}, "
                                  f"Sell on {opp.sell_dex} at {opp.sell_price:.6f}, "
                                  f"Profit: {opp.profit_percentage:.2%}")
                        
                await asyncio.sleep(1)  # Check every second
                
            except Exception as e:
                logger.error(f"Error detecting arbitrage opportunities: {e}")
                await asyncio.sleep(5)
                
    async def _find_arbitrage_for_pair(self, token_pair: str) -> Optional[ArbitrageOpportunity]:
        """Find arbitrage opportunity for a specific token pair"""
        try:
            prices = []
            
            # Collect prices from all DEXs
            for dex_name, dex_data in self.price_cache.items():
                if token_pair in dex_data:
                    price_data = dex_data[token_pair]
                    # Only consider recent data (within last 30 seconds)
                    if (datetime.now() - price_data.timestamp).seconds <= 30:
                        prices.append((dex_name, price_data))
                        
            if len(prices) < 2:
                return None
                
            # Find best buy and sell prices
            prices.sort(key=lambda x: x[1].price)
            
            buy_dex, buy_data = prices[0]  # Lowest price (best buy)
            sell_dex, sell_data = prices[-1]  # Highest price (best sell)
            
            if buy_data.price >= sell_data.price:
                return None
                
            # Calculate profit
            profit_percentage = (sell_data.price - buy_data.price) / buy_data.price
            
            # Check if profit exceeds minimum threshold
            if profit_percentage < 0.005:  # 0.5% minimum
                return None
                
            # Calculate available volume (limited by liquidity)
            max_volume = min(buy_data.liquidity, sell_data.liquidity) * 0.1  # 10% of liquidity
            
            # Estimate profit after fees
            total_fees = buy_data.spread + sell_data.spread
            net_profit_percentage = profit_percentage - total_fees
            
            if net_profit_percentage <= 0:
                return None
                
            estimated_profit = max_volume * net_profit_percentage
            
            # Calculate risk score
            risk_score = self._calculate_risk_score(buy_data, sell_data, profit_percentage)
            
            return ArbitrageOpportunity(
                token_pair=token_pair,
                buy_dex=buy_dex,
                sell_dex=sell_dex,
                buy_price=buy_data.price,
                sell_price=sell_data.price,
                profit_percentage=net_profit_percentage,
                volume_available=max_volume,
                estimated_profit=estimated_profit,
                risk_score=risk_score,
                timestamp=datetime.now()
            )
            
        except Exception as e:
            logger.error(f"Error finding arbitrage for {token_pair}: {e}")
            return None
            
    def _calculate_risk_score(self, buy_data: PriceData, sell_data: PriceData, profit_percentage: float) -> float:
        """Calculate risk score for arbitrage opportunity"""
        try:
            risk_factors = []
            
            # Liquidity risk
            min_liquidity = min(buy_data.liquidity, sell_data.liquidity)
            liquidity_risk = 1.0 / (1.0 + min_liquidity / 1000000)  # Normalize to 1M
            risk_factors.append(liquidity_risk)
            
            # Spread risk
            total_spread = buy_data.spread + sell_data.spread
            spread_risk = total_spread / profit_percentage if profit_percentage > 0 else 1.0
            risk_factors.append(min(spread_risk, 1.0))
            
            # Time risk (data freshness)
            max_age = max(
                (datetime.now() - buy_data.timestamp).seconds,
                (datetime.now() - sell_data.timestamp).seconds
            )
            time_risk = max_age / 30.0  # 30 seconds max
            risk_factors.append(min(time_risk, 1.0))
            
            # Volume risk
            volume_risk = 1.0 - min(buy_data.volume_24h, sell_data.volume_24h) / 10000000  # 10M baseline
            risk_factors.append(max(0.0, volume_risk))
            
            # Overall risk score (average of factors)
            overall_risk = np.mean(risk_factors)
            
            return float(overall_risk)
            
        except Exception as e:
            logger.error(f"Error calculating risk score: {e}")
            return 1.0  # Maximum risk on error
            
    def _get_token_symbol(self, mint_address: str) -> Optional[str]:
        """Get token symbol from mint address"""
        # Reverse lookup in TOKEN_ADDRESSES
        for symbol, address in TOKEN_ADDRESSES.items():
            if address == mint_address:
                return symbol
        return None
        
    def get_current_opportunities(self) -> List[ArbitrageOpportunity]:
        """Get current arbitrage opportunities"""
        # Filter recent opportunities (within last 10 seconds)
        cutoff_time = datetime.now() - timedelta(seconds=10)
        return [opp for opp in self.arbitrage_opportunities if opp.timestamp > cutoff_time]
        
    def get_price_data(self, dex: str = None, token_pair: str = None) -> Dict[str, Any]:
        """Get cached price data"""
        if dex and token_pair:
            return self.price_cache.get(dex, {}).get(token_pair)
        elif dex:
            return self.price_cache.get(dex, {})
        else:
            return self.price_cache
            
    def get_market_summary(self) -> Dict[str, Any]:
        """Get market summary statistics"""
        try:
            total_pairs = sum(len(dex_data) for dex_data in self.price_cache.values())
            total_opportunities = len(self.get_current_opportunities())
            
            # Calculate average spreads
            all_spreads = []
            for dex_data in self.price_cache.values():
                for price_data in dex_data.values():
                    all_spreads.append(price_data.spread)
                    
            avg_spread = np.mean(all_spreads) if all_spreads else 0.0
            
            # Get best opportunity
            opportunities = self.get_current_opportunities()
            best_opportunity = max(opportunities, key=lambda x: x.profit_percentage) if opportunities else None
            
            return {
                'total_pairs_monitored': total_pairs,
                'active_opportunities': total_opportunities,
                'average_spread': avg_spread,
                'best_opportunity': {
                    'token_pair': best_opportunity.token_pair if best_opportunity else None,
                    'profit_percentage': best_opportunity.profit_percentage if best_opportunity else 0.0,
                    'estimated_profit': best_opportunity.estimated_profit if best_opportunity else 0.0
                } if best_opportunity else None,
                'dexs_monitored': list(self.price_cache.keys()),
                'last_update': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Error generating market summary: {e}")
            return {}

