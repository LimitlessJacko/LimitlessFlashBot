"""
Configuration management for the flash loan system
"""

import os
from typing import Dict, List, Optional
from dataclasses import dataclass
from dotenv import load_dotenv

load_dotenv()

@dataclass
class SolanaConfig:
    """Solana network configuration"""
    rpc_url: str = os.getenv("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com")
    quicknode_url: str = os.getenv("QUICKNODE_URL", "")
    websocket_url: str = os.getenv("SOLANA_WS_URL", "wss://api.mainnet-beta.solana.com")
    commitment: str = "confirmed"
    program_id: str = "FLashLoanSys11111111111111111111111111111111"
    wallet_address: str = "68Jxdxbe2GC86GoJGBwNeaRAqun1ttyEEntUSnBsokMK"
    wallet_private_key: str = os.getenv("WALLET_PRIVATE_KEY", "")

@dataclass
class FlashLoanConfig:
    """Flash loan system configuration"""
    max_loan_amount: int = 1_000_000_000_000  # 1M tokens
    fee_rate: int = 30  # 0.3% in basis points
    max_slippage: int = 500  # 5% in basis points
    loan_timeout: int = 300  # 5 minutes
    min_profit_threshold: int = 1000  # Minimum profit in lamports
    gas_limit: int = 100_000  # 0.1 SOL in lamports

@dataclass
class MLConfig:
    """Machine learning configuration"""
    model_path: str = "models/"
    prediction_window: int = 60  # seconds
    training_data_size: int = 10000
    batch_size: int = 32
    epochs: int = 100
    learning_rate: float = 0.001
    feature_columns: List[str] = None

    def __post_init__(self):
        if self.feature_columns is None:
            self.feature_columns = [
                "price_change_1m", "price_change_5m", "price_change_15m",
                "volume_change_1m", "volume_change_5m", "volume_change_15m",
                "spread", "liquidity", "volatility", "momentum"
            ]

@dataclass
class QuantumConfig:
    """Quantum computing configuration"""
    backend: str = "cirq"  # cirq, qiskit, pennylane
    num_qubits: int = 4
    num_layers: int = 3
    optimization_steps: int = 100
    learning_rate: float = 0.1
    noise_model: bool = True

@dataclass
class DEXConfig:
    """DEX configuration"""
    supported_dexs: List[str] = None
    polling_interval: int = 1  # seconds
    max_price_impact: float = 0.05  # 5%
    min_liquidity: int = 100_000_000  # 100 USDC
    
    def __post_init__(self):
        if self.supported_dexs is None:
            self.supported_dexs = [
                "raydium", "orca", "serum", "jupiter", "saber",
                "aldrin", "cropper", "lifinity", "mercurial"
            ]

@dataclass
class RedisConfig:
    """Redis configuration"""
    host: str = os.getenv("REDIS_HOST", "localhost")
    port: int = int(os.getenv("REDIS_PORT", "6379"))
    db: int = int(os.getenv("REDIS_DB", "0"))
    password: str = os.getenv("REDIS_PASSWORD", "")

@dataclass
class DatabaseConfig:
    """Database configuration"""
    url: str = os.getenv("DATABASE_URL", "postgresql://user:pass@localhost/flashbot")
    pool_size: int = 10
    max_overflow: int = 20
    pool_timeout: int = 30

@dataclass
class MonitoringConfig:
    """Monitoring and logging configuration"""
    log_level: str = os.getenv("LOG_LEVEL", "INFO")
    sentry_dsn: str = os.getenv("SENTRY_DSN", "")
    prometheus_port: int = int(os.getenv("PROMETHEUS_PORT", "8000"))
    enable_metrics: bool = True

@dataclass
class Config:
    """Main configuration class"""
    solana: SolanaConfig
    flash_loan: FlashLoanConfig
    ml: MLConfig
    quantum: QuantumConfig
    dex: DEXConfig
    redis: RedisConfig
    database: DatabaseConfig
    monitoring: MonitoringConfig
    
    # API Configuration
    api_host: str = os.getenv("API_HOST", "0.0.0.0")
    api_port: int = int(os.getenv("API_PORT", "5000"))
    debug: bool = os.getenv("DEBUG", "False").lower() == "true"
    
    # Security
    api_key: str = os.getenv("API_KEY", "")
    jwt_secret: str = os.getenv("JWT_SECRET", "your-secret-key")
    
    # Rate limiting
    rate_limit_per_minute: int = int(os.getenv("RATE_LIMIT", "60"))

def load_config() -> Config:
    """Load configuration from environment variables"""
    return Config(
        solana=SolanaConfig(),
        flash_loan=FlashLoanConfig(),
        ml=MLConfig(),
        quantum=QuantumConfig(),
        dex=DEXConfig(),
        redis=RedisConfig(),
        database=DatabaseConfig(),
        monitoring=MonitoringConfig()
    )

# Global configuration instance
config = load_config()

# DEX Program IDs
DEX_PROGRAM_IDS = {
    "raydium": "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
    "orca": "9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP",
    "serum": "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
    "jupiter": "JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB",
    "saber": "SSwpkEEcbUqx4vtoEByFjSkhKdCT862DNVb52nZg1UZ",
    "aldrin": "AMM55ShdkoGRB5jVYPjWziwk8m5MpwyDgsMWHaMSQWH6",
    "cropper": "CTMAxxk34HjKWxQ3QLZK1HpaLXmBveao3ESePXbiyfzh",
    "lifinity": "EewxydAPCCVuNEyrVN68PuSYdQ7wKn27V9Gjeoi8dy3S",
    "mercurial": "MERLuDFBMmsHnsBPZw2sDQZHvXFMwp8EdjudcU2HKky"
}

# Token addresses
TOKEN_ADDRESSES = {
    "USDC": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "USDT": "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    "SOL": "So11111111111111111111111111111111111111112",
    "WSOL": "So11111111111111111111111111111111111111112",
    "RAY": "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
    "SRM": "SRMuApVNdxXokk5GT7XD5cUUgXMBCoAz2LHeuAoKWRt",
    "ORCA": "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE"
}

