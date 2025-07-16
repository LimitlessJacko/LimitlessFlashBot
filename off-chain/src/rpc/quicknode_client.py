"""
QuickNode RPC client for Solana blockchain interactions
"""

import asyncio
import json
import logging
from typing import Dict, List, Optional, Any, Union
import aiohttp
import websockets
from solana.rpc.async_api import AsyncClient
from solana.rpc.commitment import Commitment
from solana.rpc.types import TxOpts
from solana.transaction import Transaction
from solders.pubkey import Pubkey
from solders.keypair import Keypair

from ..core.config import config

logger = logging.getLogger(__name__)

class QuickNodeClient:
    """Enhanced Solana RPC client using QuickNode infrastructure"""
    
    def __init__(self, rpc_url: str = None, ws_url: str = None):
        self.rpc_url = rpc_url or config.solana.quicknode_url or config.solana.rpc_url
        self.ws_url = ws_url or config.solana.websocket_url
        self.client = AsyncClient(self.rpc_url)
        self.session: Optional[aiohttp.ClientSession] = None
        self.ws_connection: Optional[websockets.WebSocketServerProtocol] = None
        self.subscriptions: Dict[str, callable] = {}
        
    async def __aenter__(self):
        """Async context manager entry"""
        self.session = aiohttp.ClientSession()
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit"""
        if self.session:
            await self.session.close()
        if self.ws_connection:
            await self.ws_connection.close()
            
    async def get_account_info(self, pubkey: Union[str, Pubkey]) -> Optional[Dict]:
        """Get account information"""
        try:
            if isinstance(pubkey, str):
                pubkey = Pubkey.from_string(pubkey)
            
            response = await self.client.get_account_info(pubkey)
            if response.value:
                return {
                    "data": response.value.data,
                    "executable": response.value.executable,
                    "lamports": response.value.lamports,
                    "owner": str(response.value.owner),
                    "rent_epoch": response.value.rent_epoch
                }
            return None
        except Exception as e:
            logger.error(f"Error getting account info for {pubkey}: {e}")
            return None
            
    async def get_token_account_balance(self, token_account: Union[str, Pubkey]) -> Optional[Dict]:
        """Get token account balance"""
        try:
            if isinstance(token_account, str):
                token_account = Pubkey.from_string(token_account)
                
            response = await self.client.get_token_account_balance(token_account)
            if response.value:
                return {
                    "amount": response.value.amount,
                    "decimals": response.value.decimals,
                    "ui_amount": response.value.ui_amount,
                    "ui_amount_string": response.value.ui_amount_string
                }
            return None
        except Exception as e:
            logger.error(f"Error getting token balance for {token_account}: {e}")
            return None
            
    async def get_token_accounts_by_owner(self, owner: Union[str, Pubkey], mint: Union[str, Pubkey] = None) -> List[Dict]:
        """Get token accounts owned by a specific address"""
        try:
            if isinstance(owner, str):
                owner = Pubkey.from_string(owner)
            if mint and isinstance(mint, str):
                mint = Pubkey.from_string(mint)
                
            if mint:
                response = await self.client.get_token_accounts_by_owner(
                    owner, {"mint": mint}
                )
            else:
                response = await self.client.get_token_accounts_by_owner(
                    owner, {"programId": Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")}
                )
                
            accounts = []
            if response.value:
                for account in response.value:
                    accounts.append({
                        "pubkey": str(account.pubkey),
                        "account": {
                            "data": account.account.data,
                            "executable": account.account.executable,
                            "lamports": account.account.lamports,
                            "owner": str(account.account.owner),
                            "rent_epoch": account.account.rent_epoch
                        }
                    })
            return accounts
        except Exception as e:
            logger.error(f"Error getting token accounts for owner {owner}: {e}")
            return []
            
    async def get_recent_blockhash(self) -> Optional[str]:
        """Get recent blockhash"""
        try:
            response = await self.client.get_latest_blockhash()
            return str(response.value.blockhash)
        except Exception as e:
            logger.error(f"Error getting recent blockhash: {e}")
            return None
            
    async def send_transaction(self, transaction: Transaction, keypair: Keypair) -> Optional[str]:
        """Send a transaction"""
        try:
            # Sign transaction
            transaction.sign(keypair)
            
            # Send transaction
            response = await self.client.send_transaction(
                transaction,
                opts=TxOpts(skip_confirmation=False, skip_preflight=False)
            )
            
            return str(response.value)
        except Exception as e:
            logger.error(f"Error sending transaction: {e}")
            return None
            
    async def confirm_transaction(self, signature: str, commitment: str = "confirmed") -> bool:
        """Confirm a transaction"""
        try:
            response = await self.client.confirm_transaction(
                signature, 
                commitment=Commitment(commitment)
            )
            return response.value[0].confirmation_status == commitment
        except Exception as e:
            logger.error(f"Error confirming transaction {signature}: {e}")
            return False
            
    async def get_transaction(self, signature: str) -> Optional[Dict]:
        """Get transaction details"""
        try:
            response = await self.client.get_transaction(signature)
            if response.value:
                return {
                    "slot": response.value.slot,
                    "transaction": response.value.transaction,
                    "meta": response.value.meta,
                    "block_time": response.value.block_time
                }
            return None
        except Exception as e:
            logger.error(f"Error getting transaction {signature}: {e}")
            return None
            
    async def get_program_accounts(self, program_id: Union[str, Pubkey], filters: List[Dict] = None) -> List[Dict]:
        """Get accounts owned by a program"""
        try:
            if isinstance(program_id, str):
                program_id = Pubkey.from_string(program_id)
                
            response = await self.client.get_program_accounts(
                program_id,
                filters=filters or []
            )
            
            accounts = []
            if response.value:
                for account in response.value:
                    accounts.append({
                        "pubkey": str(account.pubkey),
                        "account": {
                            "data": account.account.data,
                            "executable": account.account.executable,
                            "lamports": account.account.lamports,
                            "owner": str(account.account.owner),
                            "rent_epoch": account.account.rent_epoch
                        }
                    })
            return accounts
        except Exception as e:
            logger.error(f"Error getting program accounts for {program_id}: {e}")
            return []
            
    async def subscribe_to_account(self, pubkey: Union[str, Pubkey], callback: callable):
        """Subscribe to account changes via WebSocket"""
        try:
            if isinstance(pubkey, str):
                pubkey = Pubkey.from_string(pubkey)
                
            subscription_id = f"account_{pubkey}"
            self.subscriptions[subscription_id] = callback
            
            if not self.ws_connection:
                await self._connect_websocket()
                
            # Send subscription request
            request = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "accountSubscribe",
                "params": [
                    str(pubkey),
                    {"commitment": "confirmed"}
                ]
            }
            
            await self.ws_connection.send(json.dumps(request))
            logger.info(f"Subscribed to account {pubkey}")
            
        except Exception as e:
            logger.error(f"Error subscribing to account {pubkey}: {e}")
            
    async def subscribe_to_program(self, program_id: Union[str, Pubkey], callback: callable):
        """Subscribe to program account changes"""
        try:
            if isinstance(program_id, str):
                program_id = Pubkey.from_string(program_id)
                
            subscription_id = f"program_{program_id}"
            self.subscriptions[subscription_id] = callback
            
            if not self.ws_connection:
                await self._connect_websocket()
                
            request = {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "programSubscribe",
                "params": [
                    str(program_id),
                    {"commitment": "confirmed"}
                ]
            }
            
            await self.ws_connection.send(json.dumps(request))
            logger.info(f"Subscribed to program {program_id}")
            
        except Exception as e:
            logger.error(f"Error subscribing to program {program_id}: {e}")
            
    async def _connect_websocket(self):
        """Connect to WebSocket endpoint"""
        try:
            self.ws_connection = await websockets.connect(self.ws_url)
            
            # Start listening for messages
            asyncio.create_task(self._listen_websocket())
            
        except Exception as e:
            logger.error(f"Error connecting to WebSocket: {e}")
            
    async def _listen_websocket(self):
        """Listen for WebSocket messages"""
        try:
            async for message in self.ws_connection:
                data = json.loads(message)
                
                # Handle subscription notifications
                if "method" in data and data["method"] == "accountNotification":
                    await self._handle_account_notification(data)
                elif "method" in data and data["method"] == "programNotification":
                    await self._handle_program_notification(data)
                    
        except Exception as e:
            logger.error(f"Error listening to WebSocket: {e}")
            
    async def _handle_account_notification(self, data: Dict):
        """Handle account change notifications"""
        try:
            params = data.get("params", {})
            result = params.get("result", {})
            
            # Find matching subscription
            for sub_id, callback in self.subscriptions.items():
                if sub_id.startswith("account_"):
                    await callback(result)
                    
        except Exception as e:
            logger.error(f"Error handling account notification: {e}")
            
    async def _handle_program_notification(self, data: Dict):
        """Handle program account change notifications"""
        try:
            params = data.get("params", {})
            result = params.get("result", {})
            
            # Find matching subscription
            for sub_id, callback in self.subscriptions.items():
                if sub_id.startswith("program_"):
                    await callback(result)
                    
        except Exception as e:
            logger.error(f"Error handling program notification: {e}")
            
    async def get_slot(self) -> Optional[int]:
        """Get current slot"""
        try:
            response = await self.client.get_slot()
            return response.value
        except Exception as e:
            logger.error(f"Error getting slot: {e}")
            return None
            
    async def get_block_height(self) -> Optional[int]:
        """Get current block height"""
        try:
            response = await self.client.get_block_height()
            return response.value
        except Exception as e:
            logger.error(f"Error getting block height: {e}")
            return None
            
    async def simulate_transaction(self, transaction: Transaction) -> Optional[Dict]:
        """Simulate a transaction"""
        try:
            response = await self.client.simulate_transaction(transaction)
            if response.value:
                return {
                    "err": response.value.err,
                    "logs": response.value.logs,
                    "accounts": response.value.accounts,
                    "units_consumed": response.value.units_consumed
                }
            return None
        except Exception as e:
            logger.error(f"Error simulating transaction: {e}")
            return None

