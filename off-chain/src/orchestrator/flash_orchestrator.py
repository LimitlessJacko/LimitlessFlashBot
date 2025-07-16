"""
Main orchestrator for flash loan operations with Anchor IDL integration
"""

import asyncio
import json
import logging
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime, timedelta
from dataclasses import dataclass
import os

from solders.keypair import Keypair
from solders.pubkey import Pubkey
from anchorpy import Program, Provider, Wallet, Context
from anchorpy.idl import Idl

from ..core.config import config
from ..rpc.quicknode_client import QuickNodeClient
from ..ml.prediction_model import FlashLoanPredictor
from ..quantum.signal_detector import QuantumSignalDetector
from ..dex.dex_monitor import DEXMonitor, ArbitrageOpportunity
from .transaction_manager import TransactionManager

logger = logging.getLogger(__name__)

@dataclass
class FlashLoanOpportunity:
    """Flash loan opportunity with ML and quantum analysis"""
    opportunity_type: str  # 'arbitrage' or 'liquidation'
    token_pair: str
    amount: int
    expected_profit: float
    risk_score: float
    ml_confidence: float
    quantum_signals: Dict[str, float]
    dex_data: Optional[ArbitrageOpportunity] = None
    timestamp: datetime = None
    
    def __post_init__(self):
        if self.timestamp is None:
            self.timestamp = datetime.now()

class FlashLoanOrchestrator:
    """Main orchestrator for flash loan operations"""
    
    def __init__(self, wallet_private_key: str = None):
        # Initialize wallet
        if wallet_private_key:
            self.wallet_keypair = Keypair.from_base58_string(wallet_private_key)
        else:
            self.wallet_keypair = Keypair.from_base58_string(config.solana.wallet_private_key)
            
        # Initialize components
        self.rpc_client = QuickNodeClient()
        self.transaction_manager = TransactionManager(self.rpc_client, self.wallet_keypair)
        self.ml_predictor = FlashLoanPredictor()
        self.quantum_detector = QuantumSignalDetector()
        self.dex_monitor = DEXMonitor(self.rpc_client)
        
        # Anchor program integration
        self.program: Optional[Program] = None
        self.provider: Optional[Provider] = None
        
        # Orchestrator state
        self.is_running = False
        self.opportunities_processed = 0
        self.successful_trades = 0
        self.total_profit = 0.0
        
        # Opportunity tracking
        self.active_opportunities: List[FlashLoanOpportunity] = []
        self.opportunity_history: List[Dict[str, Any]] = []
        
    async def initialize(self):
        """Initialize the orchestrator"""
        try:
            logger.info("Initializing Flash Loan Orchestrator...")
            
            # Initialize RPC client
            await self.rpc_client.__aenter__()
            
            # Load Anchor IDL and initialize program
            await self._load_anchor_program()
            
            # Initialize ML model
            if not self.ml_predictor.is_trained:
                logger.info("Loading ML model...")
                if not self.ml_predictor.load_model():
                    logger.warning("No trained ML model found. Using default predictions.")
                    
            # Initialize DEX monitor
            await self.dex_monitor.__aenter__()
            
            logger.info("Flash Loan Orchestrator initialized successfully")
            
        except Exception as e:
            logger.error(f"Error initializing orchestrator: {e}")
            raise
            
    async def _load_anchor_program(self):
        """Load Anchor program from IDL"""
        try:
            # Load IDL file
            idl_path = os.path.join(os.path.dirname(__file__), '../../target/idl/flash_loan_system.json')
            
            if os.path.exists(idl_path):
                with open(idl_path, 'r') as f:
                    idl_dict = json.load(f)
                    
                idl = Idl.from_json(idl_dict)
                
                # Create provider
                wallet = Wallet(self.wallet_keypair)
                self.provider = Provider(self.rpc_client.client, wallet)
                
                # Create program
                program_id = Pubkey.from_string(config.solana.program_id)
                self.program = Program(idl, program_id, self.provider)
                
                logger.info(f"Anchor program loaded: {program_id}")
                
            else:
                logger.warning(f"IDL file not found: {idl_path}")
                
        except Exception as e:
            logger.error(f"Error loading Anchor program: {e}")
            
    async def start(self):
        """Start the orchestrator"""
        try:
            logger.info("Starting Flash Loan Orchestrator...")
            self.is_running = True
            
            # Start DEX monitoring
            dex_task = asyncio.create_task(self.dex_monitor.start_monitoring())
            
            # Start opportunity detection
            detection_task = asyncio.create_task(self._opportunity_detection_loop())
            
            # Start opportunity execution
            execution_task = asyncio.create_task(self._opportunity_execution_loop())
            
            # Start maintenance tasks
            maintenance_task = asyncio.create_task(self._maintenance_loop())
            
            # Wait for all tasks
            await asyncio.gather(
                dex_task,
                detection_task,
                execution_task,
                maintenance_task,
                return_exceptions=True
            )
            
        except Exception as e:
            logger.error(f"Error in orchestrator: {e}")
        finally:
            self.is_running = False
            
    async def stop(self):
        """Stop the orchestrator"""
        logger.info("Stopping Flash Loan Orchestrator...")
        self.is_running = False
        await self.dex_monitor.stop_monitoring()
        
    async def _opportunity_detection_loop(self):
        """Main loop for detecting flash loan opportunities"""
        while self.is_running:
            try:
                # Get current arbitrage opportunities from DEX monitor
                arbitrage_opportunities = self.dex_monitor.get_current_opportunities()
                
                # Analyze each opportunity
                for arb_opp in arbitrage_opportunities:
                    await self._analyze_opportunity(arb_opp)
                    
                # Check for liquidation opportunities
                await self._check_liquidation_opportunities()
                
                await asyncio.sleep(1)  # Check every second
                
            except Exception as e:
                logger.error(f"Error in opportunity detection: {e}")
                await asyncio.sleep(5)
                
    async def _analyze_opportunity(self, arb_opp: ArbitrageOpportunity):
        """Analyze arbitrage opportunity with ML and quantum signals"""
        try:
            # Prepare market data for analysis
            market_data = await self._prepare_market_data(arb_opp)
            
            # Get ML prediction
            ml_prediction = self.ml_predictor.predict(market_data)
            
            # Get quantum signals
            quantum_signals = await self.quantum_detector.async_signal_detection(market_data)
            
            # Calculate combined score
            combined_score = self._calculate_combined_score(
                arb_opp, ml_prediction, quantum_signals
            )
            
            # Create opportunity if score is high enough
            if combined_score > 0.7:  # 70% confidence threshold
                opportunity = FlashLoanOpportunity(
                    opportunity_type='arbitrage',
                    token_pair=arb_opp.token_pair,
                    amount=int(arb_opp.volume_available),
                    expected_profit=arb_opp.estimated_profit,
                    risk_score=arb_opp.risk_score,
                    ml_confidence=ml_prediction['confidence'],
                    quantum_signals=quantum_signals,
                    dex_data=arb_opp
                )
                
                # Add to active opportunities
                self.active_opportunities.append(opportunity)
                
                logger.info(f"New arbitrage opportunity detected: {arb_opp.token_pair} - "
                           f"Profit: {arb_opp.estimated_profit:.6f}, Score: {combined_score:.3f}")
                
        except Exception as e:
            logger.error(f"Error analyzing opportunity: {e}")
            
    async def _prepare_market_data(self, arb_opp: ArbitrageOpportunity) -> Dict[str, Any]:
        """Prepare market data for ML and quantum analysis"""
        try:
            # Get price data from DEX monitor
            price_data = self.dex_monitor.get_price_data()
            
            # Extract relevant data for the token pair
            token_pair = arb_opp.token_pair
            
            # Collect prices and volumes
            prices = []
            volumes = []
            dex_prices = {}
            
            for dex_name, dex_data in price_data.items():
                if token_pair in dex_data:
                    price_info = dex_data[token_pair]
                    prices.append(price_info.price)
                    volumes.append(price_info.volume_24h)
                    dex_prices[dex_name] = price_info.price
                    
            # Create market data structure
            market_data = {
                'prices': prices,
                'volumes': volumes,
                'dex_prices': dex_prices,
                'spread': arb_opp.profit_percentage,
                'liquidity': arb_opp.volume_available,
                'timestamp': arb_opp.timestamp.timestamp()
            }
            
            return market_data
            
        except Exception as e:
            logger.error(f"Error preparing market data: {e}")
            return {'prices': [], 'volumes': [], 'dex_prices': {}}
            
    def _calculate_combined_score(self, arb_opp: ArbitrageOpportunity, 
                                ml_prediction: Dict[str, float], 
                                quantum_signals: Dict[str, float]) -> float:
        """Calculate combined opportunity score"""
        try:
            # Base score from arbitrage opportunity
            base_score = min(1.0, arb_opp.profit_percentage * 100)  # Convert to 0-1 scale
            
            # ML component
            ml_score = ml_prediction.get('profit_probability', 0.5) * ml_prediction.get('confidence', 0.5)
            
            # Quantum component
            quantum_score = 1.0 - quantum_signals.get('overall_anomaly', 0.5)
            
            # Risk adjustment
            risk_adjustment = 1.0 - arb_opp.risk_score
            
            # Weighted combination
            combined_score = (
                base_score * 0.4 +
                ml_score * 0.3 +
                quantum_score * 0.2 +
                risk_adjustment * 0.1
            )
            
            return min(1.0, max(0.0, combined_score))
            
        except Exception as e:
            logger.error(f"Error calculating combined score: {e}")
            return 0.0
            
    async def _check_liquidation_opportunities(self):
        """Check for liquidation opportunities"""
        try:
            # This would involve checking lending protocols for underwater positions
            # For now, we'll implement a placeholder
            
            # Get accounts from flash loan program
            if self.program:
                # Query program accounts for potential liquidations
                # This is a simplified implementation
                pass
                
        except Exception as e:
            logger.error(f"Error checking liquidation opportunities: {e}")
            
    async def _opportunity_execution_loop(self):
        """Execute profitable opportunities"""
        while self.is_running:
            try:
                if not self.active_opportunities:
                    await asyncio.sleep(0.1)
                    continue
                    
                # Sort opportunities by expected profit
                self.active_opportunities.sort(key=lambda x: x.expected_profit, reverse=True)
                
                # Execute best opportunity
                opportunity = self.active_opportunities.pop(0)
                
                # Check if opportunity is still valid
                if self._is_opportunity_valid(opportunity):
                    await self._execute_opportunity(opportunity)
                else:
                    logger.debug(f"Opportunity expired: {opportunity.token_pair}")
                    
            except Exception as e:
                logger.error(f"Error in execution loop: {e}")
                await asyncio.sleep(1)
                
    def _is_opportunity_valid(self, opportunity: FlashLoanOpportunity) -> bool:
        """Check if opportunity is still valid"""
        try:
            # Check age
            age = (datetime.now() - opportunity.timestamp).seconds
            if age > 10:  # 10 seconds max age
                return False
                
            # Check if arbitrage opportunity still exists
            if opportunity.opportunity_type == 'arbitrage' and opportunity.dex_data:
                current_opportunities = self.dex_monitor.get_current_opportunities()
                
                # Look for similar opportunity
                for current_opp in current_opportunities:
                    if (current_opp.token_pair == opportunity.token_pair and
                        current_opp.buy_dex == opportunity.dex_data.buy_dex and
                        current_opp.sell_dex == opportunity.dex_data.sell_dex and
                        current_opp.profit_percentage >= opportunity.dex_data.profit_percentage * 0.8):
                        return True
                        
                return False
                
            return True
            
        except Exception as e:
            logger.error(f"Error validating opportunity: {e}")
            return False
            
    async def _execute_opportunity(self, opportunity: FlashLoanOpportunity):
        """Execute a flash loan opportunity"""
        try:
            logger.info(f"Executing opportunity: {opportunity.token_pair} - "
                       f"Type: {opportunity.opportunity_type}, "
                       f"Expected profit: {opportunity.expected_profit}")
            
            if opportunity.opportunity_type == 'arbitrage':
                signature = await self._execute_arbitrage(opportunity)
            else:  # liquidation
                signature = await self._execute_liquidation(opportunity)
                
            if signature:
                self.opportunities_processed += 1
                self.successful_trades += 1
                self.total_profit += opportunity.expected_profit
                
                # Record in history
                self.opportunity_history.append({
                    'signature': signature,
                    'type': opportunity.opportunity_type,
                    'token_pair': opportunity.token_pair,
                    'amount': opportunity.amount,
                    'expected_profit': opportunity.expected_profit,
                    'timestamp': opportunity.timestamp,
                    'status': 'executed'
                })
                
                logger.info(f"Opportunity executed successfully: {signature}")
            else:
                logger.warning(f"Failed to execute opportunity: {opportunity.token_pair}")
                
        except Exception as e:
            logger.error(f"Error executing opportunity: {e}")
            
    async def _execute_arbitrage(self, opportunity: FlashLoanOpportunity) -> Optional[str]:
        """Execute arbitrage flash loan"""
        try:
            if not self.program or not opportunity.dex_data:
                logger.error("Program not initialized or missing DEX data")
                return None
                
            # Prepare transaction accounts
            accounts = await self._prepare_arbitrage_accounts(opportunity)
            
            # Create DEX route
            dex_route = self._create_dex_route(opportunity.dex_data)
            
            # Call flash arbitrage instruction
            tx = await self.program.rpc["flash_arbitrage"](
                opportunity.amount,
                int(opportunity.expected_profit * 0.8),  # 80% of expected profit as minimum
                dex_route,
                ctx=Context(accounts=accounts)
            )
            
            # Execute transaction
            signature = await self.transaction_manager.execute_transaction(
                tx, 'flash_arbitrage', opportunity.amount
            )
            
            return signature
            
        except Exception as e:
            logger.error(f"Error executing arbitrage: {e}")
            return None
            
    async def _execute_liquidation(self, opportunity: FlashLoanOpportunity) -> Optional[str]:
        """Execute liquidation flash loan"""
        try:
            if not self.program:
                logger.error("Program not initialized")
                return None
                
            # Prepare transaction accounts
            accounts = await self._prepare_liquidation_accounts(opportunity)
            
            # Call flash self liquidate instruction
            tx = await self.program.rpc["flash_self_liquidate"](
                opportunity.amount,
                int(opportunity.expected_profit * 0.9),  # 90% of expected as minimum
                ctx=Context(accounts=accounts)
            )
            
            # Execute transaction
            signature = await self.transaction_manager.execute_transaction(
                tx, 'flash_self_liquidate', opportunity.amount
            )
            
            return signature
            
        except Exception as e:
            logger.error(f"Error executing liquidation: {e}")
            return None
            
    async def _prepare_arbitrage_accounts(self, opportunity: FlashLoanOpportunity) -> Dict[str, Any]:
        """Prepare accounts for arbitrage transaction"""
        # This would prepare all the required accounts for the arbitrage transaction
        # Including DEX accounts, token accounts, etc.
        return {}
        
    async def _prepare_liquidation_accounts(self, opportunity: FlashLoanOpportunity) -> Dict[str, Any]:
        """Prepare accounts for liquidation transaction"""
        # This would prepare all the required accounts for the liquidation transaction
        return {}
        
    def _create_dex_route(self, arb_opp: ArbitrageOpportunity) -> bytes:
        """Create DEX route for arbitrage"""
        # Create route bytes for the arbitrage path
        route = bytearray()
        
        # Add buy DEX info
        route.extend(b'\x01')  # DEX ID for buy DEX
        route.extend(b'\x00' * 32)  # Token in pubkey
        route.extend(b'\x00' * 32)  # Token out pubkey  
        route.extend(b'\x00' * 32)  # Pool address
        
        return bytes(route)
        
    async def _maintenance_loop(self):
        """Maintenance tasks"""
        while self.is_running:
            try:
                # Clean up old opportunities
                cutoff_time = datetime.now() - timedelta(minutes=5)
                self.active_opportunities = [
                    opp for opp in self.active_opportunities
                    if opp.timestamp > cutoff_time
                ]
                
                # Optimize transaction fees
                await self.transaction_manager.optimize_gas_usage()
                
                # Clean up old transactions
                await self.transaction_manager.cleanup_old_transactions()
                
                # Update ML model if needed
                if len(self.opportunity_history) > 100:
                    await self._update_ml_model()
                    
                await asyncio.sleep(60)  # Run every minute
                
            except Exception as e:
                logger.error(f"Error in maintenance: {e}")
                await asyncio.sleep(60)
                
    async def _update_ml_model(self):
        """Update ML model with recent data"""
        try:
            # Prepare training data from recent history
            training_data = []
            
            for record in self.opportunity_history[-100:]:
                if record.get('status') == 'executed':
                    # Create training sample
                    sample = {
                        'market_data': {
                            'prices': [1.0],  # Placeholder
                            'volumes': [1000000.0],  # Placeholder
                        },
                        'profit_probability': 1.0 if record['expected_profit'] > 0 else 0.0,
                        'optimal_amount': record['amount'],
                        'risk_score': 0.3  # Placeholder
                    }
                    training_data.append(sample)
                    
            if training_data:
                self.ml_predictor.update_model(training_data)
                logger.info(f"ML model updated with {len(training_data)} samples")
                
        except Exception as e:
            logger.error(f"Error updating ML model: {e}")
            
    def get_orchestrator_status(self) -> Dict[str, Any]:
        """Get orchestrator status"""
        return {
            'is_running': self.is_running,
            'opportunities_processed': self.opportunities_processed,
            'successful_trades': self.successful_trades,
            'total_profit': self.total_profit,
            'active_opportunities': len(self.active_opportunities),
            'wallet_address': str(self.wallet_keypair.pubkey()),
            'program_loaded': self.program is not None,
            'ml_model_trained': self.ml_predictor.is_trained,
            'dex_monitor_status': self.dex_monitor.get_market_summary(),
            'transaction_manager_status': self.transaction_manager.get_manager_status()
        }
        
    async def force_execute_opportunity(self, token_pair: str, amount: int, 
                                      opportunity_type: str = 'arbitrage') -> Optional[str]:
        """Force execute an opportunity (for testing/manual execution)"""
        try:
            # Create artificial opportunity
            opportunity = FlashLoanOpportunity(
                opportunity_type=opportunity_type,
                token_pair=token_pair,
                amount=amount,
                expected_profit=amount * 0.01,  # 1% profit estimate
                risk_score=0.3,
                ml_confidence=0.8,
                quantum_signals={'overall_anomaly': 0.2}
            )
            
            return await self._execute_opportunity(opportunity)
            
        except Exception as e:
            logger.error(f"Error in force execution: {e}")
            return None

