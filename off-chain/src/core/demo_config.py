"""
Demo configuration for sandbox environment
"""

import os
from dataclasses import dataclass
from typing import Dict, List

@dataclass
class DemoConfig:
    """Demo configuration for sandbox environment"""
    
    # Wallet configuration
    wallet_address: str = "68Jxdxbe2GC86GoJGBwNeaRAqun1ttyEEntUSnBsokMK"
    wallet_private_key: str = "SK2iPdzg9Bz3k7bt8KsA2StzUgLHVuNs4d3QpaGnX6RrMpd7KDYB2NDCwFfkurkbbhRzDAb7BfkqFvjQYZ1PpCm"
    
    # Solana configuration
    rpc_url: str = "https://api.mainnet-beta.solana.com"
    commitment: str = "confirmed"
    
    # API configuration
    api_host: str = "0.0.0.0"
    api_port: int = 5000
    
    # Demo mode settings
    demo_mode: bool = True
    simulate_transactions: bool = True
    
    # Supported DEXs for demo
    supported_dexs: List[str] = None
    
    # Demo prices (simulated)
    demo_prices: Dict[str, Dict[str, float]] = None
    
    def __post_init__(self):
        if self.supported_dexs is None:
            self.supported_dexs = ["raydium", "orca", "serum", "jupiter"]
            
        if self.demo_prices is None:
            self.demo_prices = {
                "raydium": {
                    "SOL/USDC": 100.0,
                    "SOL/USDT": 100.2,
                    "RAY/USDC": 2.5
                },
                "orca": {
                    "SOL/USDC": 100.5,
                    "SOL/USDT": 100.1,
                    "ORCA/USDC": 1.8
                },
                "serum": {
                    "SOL/USDC": 99.8,
                    "SOL/USDT": 100.3,
                    "SRM/USDC": 0.5
                },
                "jupiter": {
                    "SOL/USDC": 100.3,
                    "SOL/USDT": 100.0,
                    "JUP/USDC": 0.8
                }
            }

# Global demo config instance
demo_config = DemoConfig()

