"""
Main Flask application for the Flash Loan Bot
"""

import asyncio
import logging
import os
from flask import Flask, request, jsonify
from flask_cors import CORS
import threading
from datetime import datetime

from src.core.config import config
from src.orchestrator.flash_orchestrator import FlashLoanOrchestrator

# Configure logging
logging.basicConfig(
    level=getattr(logging, config.monitoring.log_level),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

logger = logging.getLogger(__name__)

# Create Flask app
app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Global orchestrator instance
orchestrator: FlashLoanOrchestrator = None
orchestrator_task = None
event_loop = None

def run_orchestrator():
    """Run orchestrator in separate thread"""
    global orchestrator, orchestrator_task, event_loop
    
    try:
        # Create new event loop for this thread
        event_loop = asyncio.new_event_loop()
        asyncio.set_event_loop(event_loop)
        
        # Initialize and start orchestrator
        orchestrator = FlashLoanOrchestrator()
        
        async def run():
            await orchestrator.initialize()
            await orchestrator.start()
            
        event_loop.run_until_complete(run())
        
    except Exception as e:
        logger.error(f"Error running orchestrator: {e}")
    finally:
        if event_loop:
            event_loop.close()

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().isoformat(),
        'orchestrator_running': orchestrator.is_running if orchestrator else False
    })

@app.route('/status', methods=['GET'])
def get_status():
    """Get system status"""
    try:
        if not orchestrator:
            return jsonify({'error': 'Orchestrator not initialized'}), 500
            
        status = orchestrator.get_orchestrator_status()
        return jsonify(status)
        
    except Exception as e:
        logger.error(f"Error getting status: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/opportunities', methods=['GET'])
def get_opportunities():
    """Get current arbitrage opportunities"""
    try:
        if not orchestrator:
            return jsonify({'error': 'Orchestrator not initialized'}), 500
            
        opportunities = []
        for opp in orchestrator.active_opportunities:
            opportunities.append({
                'type': opp.opportunity_type,
                'token_pair': opp.token_pair,
                'amount': opp.amount,
                'expected_profit': opp.expected_profit,
                'risk_score': opp.risk_score,
                'ml_confidence': opp.ml_confidence,
                'quantum_signals': opp.quantum_signals,
                'timestamp': opp.timestamp.isoformat()
            })
            
        return jsonify({
            'opportunities': opportunities,
            'count': len(opportunities)
        })
        
    except Exception as e:
        logger.error(f"Error getting opportunities: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/dex/prices', methods=['GET'])
def get_dex_prices():
    """Get current DEX prices"""
    try:
        if not orchestrator:
            return jsonify({'error': 'Orchestrator not initialized'}), 500
            
        dex = request.args.get('dex')
        token_pair = request.args.get('token_pair')
        
        price_data = orchestrator.dex_monitor.get_price_data(dex, token_pair)
        
        if isinstance(price_data, dict) and hasattr(price_data, 'timestamp'):
            # Single price data object
            return jsonify({
                'dex': price_data.dex,
                'token_pair': price_data.token_pair,
                'price': price_data.price,
                'volume_24h': price_data.volume_24h,
                'liquidity': price_data.liquidity,
                'spread': price_data.spread,
                'timestamp': price_data.timestamp.isoformat()
            })
        else:
            # Multiple price data
            result = {}
            for dex_name, dex_data in price_data.items():
                result[dex_name] = {}
                for pair, data in dex_data.items():
                    result[dex_name][pair] = {
                        'price': data.price,
                        'volume_24h': data.volume_24h,
                        'liquidity': data.liquidity,
                        'spread': data.spread,
                        'timestamp': data.timestamp.isoformat()
                    }
                    
            return jsonify(result)
        
    except Exception as e:
        logger.error(f"Error getting DEX prices: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/dex/arbitrage', methods=['GET'])
def get_arbitrage_opportunities():
    """Get current arbitrage opportunities from DEX monitor"""
    try:
        if not orchestrator:
            return jsonify({'error': 'Orchestrator not initialized'}), 500
            
        opportunities = orchestrator.dex_monitor.get_current_opportunities()
        
        result = []
        for opp in opportunities:
            result.append({
                'token_pair': opp.token_pair,
                'buy_dex': opp.buy_dex,
                'sell_dex': opp.sell_dex,
                'buy_price': opp.buy_price,
                'sell_price': opp.sell_price,
                'profit_percentage': opp.profit_percentage,
                'volume_available': opp.volume_available,
                'estimated_profit': opp.estimated_profit,
                'risk_score': opp.risk_score,
                'timestamp': opp.timestamp.isoformat()
            })
            
        return jsonify({
            'opportunities': result,
            'count': len(result)
        })
        
    except Exception as e:
        logger.error(f"Error getting arbitrage opportunities: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/ml/predict', methods=['POST'])
def ml_predict():
    """Get ML prediction for market data"""
    try:
        if not orchestrator:
            return jsonify({'error': 'Orchestrator not initialized'}), 500
            
        market_data = request.json
        if not market_data:
            return jsonify({'error': 'No market data provided'}), 400
            
        prediction = orchestrator.ml_predictor.predict(market_data)
        return jsonify(prediction)
        
    except Exception as e:
        logger.error(f"Error in ML prediction: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/quantum/signals', methods=['POST'])
def quantum_signals():
    """Get quantum signals for market data"""
    try:
        if not orchestrator:
            return jsonify({'error': 'Orchestrator not initialized'}), 500
            
        market_data = request.json
        if not market_data:
            return jsonify({'error': 'No market data provided'}), 400
            
        # Run quantum detection in event loop
        if event_loop and event_loop.is_running():
            future = asyncio.run_coroutine_threadsafe(
                orchestrator.quantum_detector.async_signal_detection(market_data),
                event_loop
            )
            signals = future.result(timeout=10)
        else:
            signals = orchestrator.quantum_detector.detect_quantum_anomalies(market_data)
            
        return jsonify(signals)
        
    except Exception as e:
        logger.error(f"Error in quantum signals: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/transactions/status/<signature>', methods=['GET'])
def get_transaction_status(signature):
    """Get transaction status"""
    try:
        if not orchestrator:
            return jsonify({'error': 'Orchestrator not initialized'}), 500
            
        # Run in event loop
        if event_loop and event_loop.is_running():
            future = asyncio.run_coroutine_threadsafe(
                orchestrator.transaction_manager.get_transaction_status(signature),
                event_loop
            )
            status = future.result(timeout=10)
        else:
            status = {'error': 'Event loop not available'}
            
        return jsonify(status)
        
    except Exception as e:
        logger.error(f"Error getting transaction status: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/transactions/fees', methods=['GET'])
def get_fee_statistics():
    """Get fee statistics"""
    try:
        if not orchestrator:
            return jsonify({'error': 'Orchestrator not initialized'}), 500
            
        stats = orchestrator.transaction_manager.get_fee_statistics()
        return jsonify(stats)
        
    except Exception as e:
        logger.error(f"Error getting fee statistics: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/execute', methods=['POST'])
def execute_opportunity():
    """Manually execute an opportunity"""
    try:
        if not orchestrator:
            return jsonify({'error': 'Orchestrator not initialized'}), 500
            
        data = request.json
        if not data:
            return jsonify({'error': 'No data provided'}), 400
            
        token_pair = data.get('token_pair')
        amount = data.get('amount')
        opportunity_type = data.get('type', 'arbitrage')
        
        if not token_pair or not amount:
            return jsonify({'error': 'token_pair and amount required'}), 400
            
        # Execute in event loop
        if event_loop and event_loop.is_running():
            future = asyncio.run_coroutine_threadsafe(
                orchestrator.force_execute_opportunity(token_pair, amount, opportunity_type),
                event_loop
            )
            signature = future.result(timeout=30)
        else:
            signature = None
            
        if signature:
            return jsonify({
                'status': 'success',
                'signature': signature,
                'message': 'Opportunity executed successfully'
            })
        else:
            return jsonify({
                'status': 'failed',
                'message': 'Failed to execute opportunity'
            }), 500
            
    except Exception as e:
        logger.error(f"Error executing opportunity: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/start', methods=['POST'])
def start_orchestrator():
    """Start the orchestrator"""
    global orchestrator_task
    
    try:
        if orchestrator and orchestrator.is_running:
            return jsonify({'message': 'Orchestrator already running'})
            
        # Start orchestrator in background thread
        orchestrator_task = threading.Thread(target=run_orchestrator, daemon=True)
        orchestrator_task.start()
        
        return jsonify({'message': 'Orchestrator starting...'})
        
    except Exception as e:
        logger.error(f"Error starting orchestrator: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/stop', methods=['POST'])
def stop_orchestrator():
    """Stop the orchestrator"""
    try:
        if orchestrator:
            if event_loop and event_loop.is_running():
                future = asyncio.run_coroutine_threadsafe(
                    orchestrator.stop(),
                    event_loop
                )
                future.result(timeout=10)
                
        return jsonify({'message': 'Orchestrator stopped'})
        
    except Exception as e:
        logger.error(f"Error stopping orchestrator: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/config', methods=['GET'])
def get_config():
    """Get current configuration"""
    return jsonify({
        'solana': {
            'rpc_url': config.solana.rpc_url,
            'program_id': config.solana.program_id,
            'commitment': config.solana.commitment
        },
        'flash_loan': {
            'max_loan_amount': config.flash_loan.max_loan_amount,
            'fee_rate': config.flash_loan.fee_rate,
            'max_slippage': config.flash_loan.max_slippage,
            'gas_limit': config.flash_loan.gas_limit
        },
        'dex': {
            'supported_dexs': config.dex.supported_dexs,
            'polling_interval': config.dex.polling_interval,
            'max_price_impact': config.dex.max_price_impact,
            'min_liquidity': config.dex.min_liquidity
        },
        'ml': {
            'prediction_window': config.ml.prediction_window,
            'batch_size': config.ml.batch_size,
            'learning_rate': config.ml.learning_rate
        },
        'quantum': {
            'num_qubits': config.quantum.num_qubits,
            'num_layers': config.quantum.num_layers,
            'optimization_steps': config.quantum.optimization_steps
        }
    })

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    # Start orchestrator automatically
    orchestrator_task = threading.Thread(target=run_orchestrator, daemon=True)
    orchestrator_task.start()
    
    # Start Flask app
    app.run(
        host=config.api_host,
        port=config.api_port,
        debug=config.debug
    )

