"""
Transaction manager with fee wrapping and optimization
"""

import asyncio
import logging
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass
from datetime import datetime, timedelta
import json

from solana.rpc.async_api import AsyncClient
from solana.transaction import Transaction
from solana.system_program import TransferParams, transfer
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.system_program import ID as SYSTEM_PROGRAM_ID
from anchorpy import Program, Provider, Wallet

from ..core.config import config
from ..rpc.quicknode_client import QuickNodeClient

logger = logging.getLogger(__name__)

@dataclass
class TransactionCost:
    """Transaction cost breakdown"""
    base_fee: int  # Base transaction fee
    compute_units: int  # Compute units required
    priority_fee: int  # Priority fee for faster processing
    flash_loan_fee: int  # Flash loan protocol fee
    total_cost: int  # Total cost in lamports
    
@dataclass
class FeeWrapper:
    """Fee wrapper configuration"""
    max_user_fee: int = 100_000  # 0.1 SOL in lamports
    flash_loan_covers: bool = True
    priority_multiplier: float = 1.5
    
class TransactionManager:
    """Manages transactions with optimized fee handling"""
    
    def __init__(self, rpc_client: QuickNodeClient, wallet_keypair: Keypair):
        self.rpc_client = rpc_client
        self.wallet = wallet_keypair
        self.fee_wrapper = FeeWrapper()
        
        # Transaction tracking
        self.pending_transactions: Dict[str, Dict[str, Any]] = {}
        self.transaction_history: List[Dict[str, Any]] = []
        
        # Fee optimization
        self.recent_fees: List[int] = []
        self.base_fee_cache: Optional[int] = None
        self.last_fee_update: Optional[datetime] = None
        
    async def estimate_transaction_cost(self, transaction_type: str, amount: int) -> TransactionCost:
        """Estimate total transaction cost"""
        try:
            # Get current base fee
            base_fee = await self._get_current_base_fee()
            
            # Estimate compute units based on transaction type
            compute_units = self._estimate_compute_units(transaction_type)
            
            # Calculate priority fee
            priority_fee = int(base_fee * self.fee_wrapper.priority_multiplier)
            
            # Calculate flash loan fee
            flash_loan_fee = self._calculate_flash_loan_fee(amount)
            
            # Total cost
            total_cost = base_fee + priority_fee + flash_loan_fee
            
            return TransactionCost(
                base_fee=base_fee,
                compute_units=compute_units,
                priority_fee=priority_fee,
                flash_loan_fee=flash_loan_fee,
                total_cost=total_cost
            )
            
        except Exception as e:
            logger.error(f"Error estimating transaction cost: {e}")
            # Return conservative estimate
            return TransactionCost(
                base_fee=5000,
                compute_units=200000,
                priority_fee=7500,
                flash_loan_fee=amount * 30 // 10000,  # 0.3%
                total_cost=50000
            )
            
    async def _get_current_base_fee(self) -> int:
        """Get current base fee with caching"""
        try:
            # Use cached fee if recent (within 30 seconds)
            if (self.base_fee_cache and self.last_fee_update and 
                (datetime.now() - self.last_fee_update).seconds < 30):
                return self.base_fee_cache
                
            # Get recent blockhash and fee
            recent_blockhash = await self.rpc_client.get_recent_blockhash()
            if recent_blockhash:
                # Estimate base fee (simplified)
                base_fee = 5000  # Default Solana base fee
                
                # Adjust based on network congestion
                slot = await self.rpc_client.get_slot()
                if slot:
                    # Simple congestion adjustment
                    congestion_multiplier = min(2.0, 1.0 + (slot % 100) / 1000)
                    base_fee = int(base_fee * congestion_multiplier)
                    
                self.base_fee_cache = base_fee
                self.last_fee_update = datetime.now()
                
                return base_fee
                
            return 5000  # Fallback
            
        except Exception as e:
            logger.error(f"Error getting base fee: {e}")
            return 5000
            
    def _estimate_compute_units(self, transaction_type: str) -> int:
        """Estimate compute units for different transaction types"""
        compute_units_map = {
            'flash_self_liquidate': 300000,
            'flash_arbitrage': 400000,
            'repay_flash_loan': 100000,
            'simple_transfer': 21000
        }
        
        return compute_units_map.get(transaction_type, 200000)
        
    def _calculate_flash_loan_fee(self, amount: int) -> int:
        """Calculate flash loan protocol fee"""
        return (amount * config.flash_loan.fee_rate) // 10000
        
    async def wrap_transaction_fees(self, transaction: Transaction, transaction_type: str, amount: int) -> Transaction:
        """Wrap transaction fees to be paid from flash loan"""
        try:
            # Estimate costs
            cost = await self.estimate_transaction_cost(transaction_type, amount)
            
            # Check if user fee is within limit
            user_fee = min(cost.base_fee + cost.priority_fee, self.fee_wrapper.max_user_fee)
            flash_loan_covers = cost.total_cost - user_fee
            
            if flash_loan_covers > 0 and self.fee_wrapper.flash_loan_covers:
                # Add instruction to cover excess fees from flash loan
                fee_coverage_ix = self._create_fee_coverage_instruction(flash_loan_covers)
                transaction.add(fee_coverage_ix)
                
            # Set compute budget
            compute_budget_ix = self._create_compute_budget_instruction(cost.compute_units)
            transaction.add(compute_budget_ix)
            
            # Set priority fee
            if cost.priority_fee > 0:
                priority_fee_ix = self._create_priority_fee_instruction(cost.priority_fee)
                transaction.add(priority_fee_ix)
                
            logger.info(f"Transaction wrapped - User pays: {user_fee} lamports, "
                       f"Flash loan covers: {flash_loan_covers} lamports")
            
            return transaction
            
        except Exception as e:
            logger.error(f"Error wrapping transaction fees: {e}")
            return transaction
            
    def _create_fee_coverage_instruction(self, amount: int):
        """Create instruction to cover fees from flash loan proceeds"""
        # This would be a custom instruction in your program
        # For now, we'll create a transfer instruction as placeholder
        return transfer(
            TransferParams(
                from_pubkey=self.wallet.pubkey(),
                to_pubkey=self.wallet.pubkey(),  # Self-transfer for fee coverage
                lamports=amount
            )
        )
        
    def _create_compute_budget_instruction(self, compute_units: int):
        """Create compute budget instruction"""
        # Solana compute budget program instruction
        from solana.system_program import create_account, CreateAccountParams
        
        # This is a simplified version - you'd use the actual compute budget program
        return transfer(
            TransferParams(
                from_pubkey=self.wallet.pubkey(),
                to_pubkey=SYSTEM_PROGRAM_ID,
                lamports=0  # No lamports for compute budget
            )
        )
        
    def _create_priority_fee_instruction(self, priority_fee: int):
        """Create priority fee instruction"""
        # Priority fee instruction for faster processing
        return transfer(
            TransferParams(
                from_pubkey=self.wallet.pubkey(),
                to_pubkey=SYSTEM_PROGRAM_ID,
                lamports=priority_fee
            )
        )
        
    async def execute_transaction(self, transaction: Transaction, transaction_type: str, 
                                amount: int = 0, max_retries: int = 3) -> Optional[str]:
        """Execute transaction with fee optimization and retries"""
        try:
            # Wrap fees
            wrapped_transaction = await self.wrap_transaction_fees(transaction, transaction_type, amount)
            
            # Get recent blockhash
            recent_blockhash = await self.rpc_client.get_recent_blockhash()
            if not recent_blockhash:
                logger.error("Failed to get recent blockhash")
                return None
                
            wrapped_transaction.recent_blockhash = recent_blockhash
            
            # Sign transaction
            wrapped_transaction.sign(self.wallet)
            
            # Simulate transaction first
            simulation = await self.rpc_client.simulate_transaction(wrapped_transaction)
            if simulation and simulation.get('err'):
                logger.error(f"Transaction simulation failed: {simulation['err']}")
                return None
                
            # Send transaction with retries
            for attempt in range(max_retries):
                try:
                    signature = await self.rpc_client.send_transaction(wrapped_transaction, self.wallet)
                    
                    if signature:
                        # Track transaction
                        self.pending_transactions[signature] = {
                            'type': transaction_type,
                            'amount': amount,
                            'timestamp': datetime.now(),
                            'status': 'pending'
                        }
                        
                        logger.info(f"Transaction sent: {signature} (attempt {attempt + 1})")
                        
                        # Confirm transaction
                        confirmed = await self._confirm_transaction(signature)
                        if confirmed:
                            self.pending_transactions[signature]['status'] = 'confirmed'
                            self._record_transaction_success(signature, transaction_type, amount)
                            return signature
                        else:
                            self.pending_transactions[signature]['status'] = 'failed'
                            
                    await asyncio.sleep(1)  # Wait before retry
                    
                except Exception as e:
                    logger.warning(f"Transaction attempt {attempt + 1} failed: {e}")
                    if attempt == max_retries - 1:
                        raise
                        
            return None
            
        except Exception as e:
            logger.error(f"Error executing transaction: {e}")
            return None
            
    async def _confirm_transaction(self, signature: str, timeout: int = 30) -> bool:
        """Confirm transaction with timeout"""
        try:
            start_time = datetime.now()
            
            while (datetime.now() - start_time).seconds < timeout:
                confirmed = await self.rpc_client.confirm_transaction(signature)
                if confirmed:
                    return True
                    
                await asyncio.sleep(2)  # Check every 2 seconds
                
            logger.warning(f"Transaction confirmation timeout: {signature}")
            return False
            
        except Exception as e:
            logger.error(f"Error confirming transaction {signature}: {e}")
            return False
            
    def _record_transaction_success(self, signature: str, transaction_type: str, amount: int):
        """Record successful transaction for fee optimization"""
        try:
            transaction_record = {
                'signature': signature,
                'type': transaction_type,
                'amount': amount,
                'timestamp': datetime.now(),
                'status': 'confirmed'
            }
            
            self.transaction_history.append(transaction_record)
            
            # Keep only recent history (last 100 transactions)
            if len(self.transaction_history) > 100:
                self.transaction_history = self.transaction_history[-100:]
                
        except Exception as e:
            logger.error(f"Error recording transaction: {e}")
            
    async def optimize_gas_usage(self) -> Dict[str, Any]:
        """Optimize gas usage based on historical data"""
        try:
            if not self.transaction_history:
                return {'status': 'no_data'}
                
            # Analyze recent transactions
            recent_transactions = [
                tx for tx in self.transaction_history 
                if (datetime.now() - tx['timestamp']).days < 1
            ]
            
            if not recent_transactions:
                return {'status': 'no_recent_data'}
                
            # Calculate success rate
            successful_txs = [tx for tx in recent_transactions if tx['status'] == 'confirmed']
            success_rate = len(successful_txs) / len(recent_transactions)
            
            # Analyze fee patterns
            avg_amount = sum(tx['amount'] for tx in successful_txs) / len(successful_txs)
            
            # Optimize fee wrapper settings
            if success_rate < 0.9:  # Less than 90% success rate
                self.fee_wrapper.priority_multiplier *= 1.1  # Increase priority fee
            elif success_rate > 0.95:  # Very high success rate
                self.fee_wrapper.priority_multiplier *= 0.95  # Decrease priority fee
                
            # Ensure reasonable bounds
            self.fee_wrapper.priority_multiplier = max(1.0, min(3.0, self.fee_wrapper.priority_multiplier))
            
            return {
                'status': 'optimized',
                'success_rate': success_rate,
                'avg_amount': avg_amount,
                'priority_multiplier': self.fee_wrapper.priority_multiplier,
                'total_transactions': len(recent_transactions)
            }
            
        except Exception as e:
            logger.error(f"Error optimizing gas usage: {e}")
            return {'status': 'error', 'error': str(e)}
            
    async def get_transaction_status(self, signature: str) -> Dict[str, Any]:
        """Get transaction status"""
        try:
            # Check pending transactions
            if signature in self.pending_transactions:
                pending_info = self.pending_transactions[signature]
                
                # Update status if needed
                if pending_info['status'] == 'pending':
                    confirmed = await self.rpc_client.confirm_transaction(signature)
                    if confirmed:
                        pending_info['status'] = 'confirmed'
                        self._record_transaction_success(
                            signature, 
                            pending_info['type'], 
                            pending_info['amount']
                        )
                        
                return pending_info
                
            # Check transaction history
            for tx in self.transaction_history:
                if tx['signature'] == signature:
                    return tx
                    
            # Get from blockchain
            tx_info = await self.rpc_client.get_transaction(signature)
            if tx_info:
                return {
                    'signature': signature,
                    'status': 'confirmed' if tx_info else 'not_found',
                    'block_time': tx_info.get('block_time') if tx_info else None,
                    'slot': tx_info.get('slot') if tx_info else None
                }
                
            return {'signature': signature, 'status': 'not_found'}
            
        except Exception as e:
            logger.error(f"Error getting transaction status: {e}")
            return {'signature': signature, 'status': 'error', 'error': str(e)}
            
    def get_fee_statistics(self) -> Dict[str, Any]:
        """Get fee usage statistics"""
        try:
            if not self.transaction_history:
                return {'status': 'no_data'}
                
            recent_txs = [
                tx for tx in self.transaction_history 
                if (datetime.now() - tx['timestamp']).hours < 24
            ]
            
            if not recent_txs:
                return {'status': 'no_recent_data'}
                
            # Calculate statistics
            total_transactions = len(recent_txs)
            successful_transactions = len([tx for tx in recent_txs if tx['status'] == 'confirmed'])
            
            # Estimate total fees paid
            estimated_fees = 0
            for tx in recent_txs:
                if tx['status'] == 'confirmed':
                    # Estimate fee based on transaction type and amount
                    base_fee = 5000
                    priority_fee = int(base_fee * self.fee_wrapper.priority_multiplier)
                    flash_loan_fee = (tx['amount'] * config.flash_loan.fee_rate) // 10000
                    estimated_fees += base_fee + priority_fee + flash_loan_fee
                    
            return {
                'status': 'success',
                'period': '24h',
                'total_transactions': total_transactions,
                'successful_transactions': successful_transactions,
                'success_rate': successful_transactions / total_transactions,
                'estimated_total_fees': estimated_fees,
                'avg_fee_per_transaction': estimated_fees / successful_transactions if successful_transactions > 0 else 0,
                'current_priority_multiplier': self.fee_wrapper.priority_multiplier,
                'max_user_fee_limit': self.fee_wrapper.max_user_fee
            }
            
        except Exception as e:
            logger.error(f"Error getting fee statistics: {e}")
            return {'status': 'error', 'error': str(e)}
            
    async def cleanup_old_transactions(self, max_age_hours: int = 24):
        """Clean up old transaction records"""
        try:
            cutoff_time = datetime.now() - timedelta(hours=max_age_hours)
            
            # Clean pending transactions
            expired_pending = [
                sig for sig, tx_info in self.pending_transactions.items()
                if tx_info['timestamp'] < cutoff_time
            ]
            
            for sig in expired_pending:
                del self.pending_transactions[sig]
                
            # Clean transaction history
            self.transaction_history = [
                tx for tx in self.transaction_history
                if tx['timestamp'] > cutoff_time
            ]
            
            logger.info(f"Cleaned up {len(expired_pending)} pending and "
                       f"{len(self.transaction_history)} historical transactions")
            
        except Exception as e:
            logger.error(f"Error cleaning up transactions: {e}")
            
    def get_manager_status(self) -> Dict[str, Any]:
        """Get transaction manager status"""
        return {
            'pending_transactions': len(self.pending_transactions),
            'transaction_history_size': len(self.transaction_history),
            'fee_wrapper_config': {
                'max_user_fee': self.fee_wrapper.max_user_fee,
                'flash_loan_covers': self.fee_wrapper.flash_loan_covers,
                'priority_multiplier': self.fee_wrapper.priority_multiplier
            },
            'last_fee_update': self.last_fee_update.isoformat() if self.last_fee_update else None,
            'cached_base_fee': self.base_fee_cache
        }

