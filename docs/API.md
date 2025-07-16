# API Documentation

## Overview

The Limitless Flash Bot provides a comprehensive RESTful API for monitoring, controlling, and interacting with the flash loan system. All endpoints return JSON responses and support standard HTTP methods.

## Base URL

```
http://localhost:5000
```

## Authentication

Most endpoints require API key authentication via the `X-API-Key` header:

```bash
curl -H "X-API-Key: your_api_key" http://localhost:5000/endpoint
```

## Response Format

All API responses follow this standard format:

```json
{
  "status": "success|error",
  "data": {},
  "message": "Optional message",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

## Endpoints

### System Health

#### GET /health
Returns basic system health status.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00Z",
  "orchestrator_running": true
}
```

#### GET /status
Returns detailed system status including all components.

**Response:**
```json
{
  "is_running": true,
  "opportunities_processed": 150,
  "successful_trades": 142,
  "total_profit": 12.5,
  "active_opportunities": 3,
  "wallet_address": "ABC123...",
  "program_loaded": true,
  "ml_model_trained": true,
  "dex_monitor_status": {},
  "transaction_manager_status": {}
}
```

### Opportunities

#### GET /opportunities
Returns current flash loan opportunities detected by the system.

**Response:**
```json
{
  "opportunities": [
    {
      "type": "arbitrage",
      "token_pair": "SOL/USDC",
      "amount": 1000000,
      "expected_profit": 0.025,
      "risk_score": 0.3,
      "ml_confidence": 0.85,
      "quantum_signals": {
        "overall_anomaly": 0.2,
        "price_anomaly": 0.15,
        "volume_anomaly": 0.25
      },
      "timestamp": "2024-01-01T00:00:00Z"
    }
  ],
  "count": 1
}
```

#### GET /dex/arbitrage
Returns current arbitrage opportunities from DEX monitor.

**Response:**
```json
{
  "opportunities": [
    {
      "token_pair": "SOL/USDC",
      "buy_dex": "raydium",
      "sell_dex": "orca",
      "buy_price": 100.0,
      "sell_price": 100.5,
      "profit_percentage": 0.005,
      "volume_available": 1000000,
      "estimated_profit": 5000,
      "risk_score": 0.2,
      "timestamp": "2024-01-01T00:00:00Z"
    }
  ],
  "count": 1
}
```

### DEX Data

#### GET /dex/prices
Returns current prices from all monitored DEXs.

**Parameters:**
- `dex` (optional): Filter by specific DEX
- `token_pair` (optional): Filter by token pair

**Response:**
```json
{
  "raydium": {
    "SOL/USDC": {
      "price": 100.0,
      "volume_24h": 1000000,
      "liquidity": 5000000,
      "spread": 0.001,
      "timestamp": "2024-01-01T00:00:00Z"
    }
  },
  "orca": {
    "SOL/USDC": {
      "price": 100.5,
      "volume_24h": 800000,
      "liquidity": 4000000,
      "spread": 0.002,
      "timestamp": "2024-01-01T00:00:00Z"
    }
  }
}
```

### Execution

#### POST /execute
Manually execute a flash loan opportunity.

**Request Body:**
```json
{
  "token_pair": "SOL/USDC",
  "amount": 1000000,
  "type": "arbitrage"
}
```

**Response:**
```json
{
  "status": "success",
  "signature": "ABC123...",
  "message": "Opportunity executed successfully"
}
```

#### POST /start
Start the orchestrator.

**Response:**
```json
{
  "message": "Orchestrator starting..."
}
```

#### POST /stop
Stop the orchestrator.

**Response:**
```json
{
  "message": "Orchestrator stopped"
}
```

### Analysis

#### POST /ml/predict
Get ML prediction for market data.

**Request Body:**
```json
{
  "prices": [100, 101, 99, 102],
  "volumes": [1000000, 1100000, 900000, 1200000],
  "dex_prices": {
    "raydium": 100.0,
    "orca": 100.5
  },
  "spread": 0.005,
  "liquidity": 5000000,
  "timestamp": 1640995200
}
```

**Response:**
```json
{
  "profit_probability": 0.85,
  "optimal_amount": 1000000,
  "risk_score": 0.3,
  "confidence": 0.9,
  "predicted_profit": 0.025
}
```

#### POST /quantum/signals
Get quantum signal analysis for market data.

**Request Body:**
```json
{
  "prices": [100, 101, 99, 102],
  "volumes": [1000000, 1100000, 900000, 1200000]
}
```

**Response:**
```json
{
  "overall_anomaly": 0.2,
  "price_anomaly": 0.15,
  "volume_anomaly": 0.25,
  "correlation_strength": 0.8,
  "quantum_advantage": 0.1
}
```

### Transactions

#### GET /transactions/status/{signature}
Get status of a specific transaction.

**Response:**
```json
{
  "signature": "ABC123...",
  "status": "confirmed",
  "type": "arbitrage",
  "amount": 1000000,
  "timestamp": "2024-01-01T00:00:00Z",
  "block_time": 1640995200,
  "slot": 123456789
}
```

#### GET /transactions/fees
Get fee statistics.

**Response:**
```json
{
  "status": "success",
  "period": "24h",
  "total_transactions": 50,
  "successful_transactions": 48,
  "success_rate": 0.96,
  "estimated_total_fees": 250000,
  "avg_fee_per_transaction": 5208,
  "current_priority_multiplier": 1.2,
  "max_user_fee_limit": 100000
}
```

### Configuration

#### GET /config
Get current system configuration.

**Response:**
```json
{
  "solana": {
    "rpc_url": "https://api.mainnet-beta.solana.com",
    "program_id": "ABC123...",
    "commitment": "confirmed"
  },
  "flash_loan": {
    "max_loan_amount": 1000000000000,
    "fee_rate": 30,
    "max_slippage": 500,
    "gas_limit": 100000
  },
  "dex": {
    "supported_dexs": ["raydium", "orca", "serum"],
    "polling_interval": 1,
    "max_price_impact": 0.05,
    "min_liquidity": 100000000
  },
  "ml": {
    "prediction_window": 60,
    "batch_size": 32,
    "learning_rate": 0.001
  },
  "quantum": {
    "num_qubits": 4,
    "num_layers": 3,
    "optimization_steps": 100
  }
}
```

## Error Codes

The API uses standard HTTP status codes:

- `200` - Success
- `400` - Bad Request
- `401` - Unauthorized
- `404` - Not Found
- `429` - Too Many Requests
- `500` - Internal Server Error

## Rate Limiting

API endpoints are rate limited to prevent abuse:

- Default: 60 requests per minute per API key
- Burst: Up to 100 requests in a 10-second window

Rate limit headers are included in responses:
```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 59
X-RateLimit-Reset: 1640995260
```

## WebSocket API

For real-time updates, connect to the WebSocket endpoint:

```javascript
const ws = new WebSocket('ws://localhost:5000/ws');

ws.onmessage = function(event) {
  const data = JSON.parse(event.data);
  console.log('Received:', data);
};
```

### WebSocket Events

- `opportunity_detected` - New arbitrage opportunity
- `trade_executed` - Trade execution result
- `price_update` - DEX price updates
- `system_status` - System status changes

## SDK Examples

### Python SDK
```python
import requests

class FlashBotAPI:
    def __init__(self, base_url, api_key):
        self.base_url = base_url
        self.headers = {'X-API-Key': api_key}
    
    def get_opportunities(self):
        response = requests.get(
            f"{self.base_url}/opportunities",
            headers=self.headers
        )
        return response.json()
    
    def execute_trade(self, token_pair, amount, trade_type):
        data = {
            'token_pair': token_pair,
            'amount': amount,
            'type': trade_type
        }
        response = requests.post(
            f"{self.base_url}/execute",
            json=data,
            headers=self.headers
        )
        return response.json()

# Usage
api = FlashBotAPI('http://localhost:5000', 'your_api_key')
opportunities = api.get_opportunities()
```

### JavaScript SDK
```javascript
class FlashBotAPI {
  constructor(baseUrl, apiKey) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  async getOpportunities() {
    const response = await fetch(`${this.baseUrl}/opportunities`, {
      headers: {
        'X-API-Key': this.apiKey
      }
    });
    return response.json();
  }

  async executeTrade(tokenPair, amount, type) {
    const response = await fetch(`${this.baseUrl}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey
      },
      body: JSON.stringify({
        token_pair: tokenPair,
        amount: amount,
        type: type
      })
    });
    return response.json();
  }
}

// Usage
const api = new FlashBotAPI('http://localhost:5000', 'your_api_key');
const opportunities = await api.getOpportunities();
```

