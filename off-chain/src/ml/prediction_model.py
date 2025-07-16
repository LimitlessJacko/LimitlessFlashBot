"""
TensorFlow-based prediction model for flash loan opportunities
"""

import os
import numpy as np
import pandas as pd
import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers
from sklearn.preprocessing import StandardScaler, MinMaxScaler
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_squared_error, mean_absolute_error
import joblib
import logging
from typing import Dict, List, Tuple, Optional, Any
from datetime import datetime, timedelta

from ..core.config import config

logger = logging.getLogger(__name__)

class FlashLoanPredictor:
    """TensorFlow model for predicting flash loan opportunities"""
    
    def __init__(self, model_path: str = None):
        self.model_path = model_path or config.ml.model_path
        self.model: Optional[keras.Model] = None
        self.scaler: Optional[StandardScaler] = None
        self.feature_columns = config.ml.feature_columns
        self.prediction_window = config.ml.prediction_window
        self.is_trained = False
        
        # Ensure model directory exists
        os.makedirs(self.model_path, exist_ok=True)
        
    def create_model(self, input_shape: int) -> keras.Model:
        """Create the neural network model"""
        model = keras.Sequential([
            # Input layer
            layers.Dense(128, activation='relu', input_shape=(input_shape,)),
            layers.Dropout(0.2),
            
            # Hidden layers
            layers.Dense(256, activation='relu'),
            layers.BatchNormalization(),
            layers.Dropout(0.3),
            
            layers.Dense(128, activation='relu'),
            layers.BatchNormalization(),
            layers.Dropout(0.2),
            
            layers.Dense(64, activation='relu'),
            layers.Dropout(0.1),
            
            # Output layers
            layers.Dense(32, activation='relu'),
            layers.Dense(3, activation='linear', name='predictions')  # [profit_probability, optimal_amount, risk_score]
        ])
        
        # Compile model
        model.compile(
            optimizer=keras.optimizers.Adam(learning_rate=config.ml.learning_rate),
            loss='mse',
            metrics=['mae', 'mse']
        )
        
        return model
        
    def prepare_features(self, market_data: Dict[str, Any]) -> np.ndarray:
        """Prepare features from market data"""
        try:
            features = []
            
            # Price-based features
            prices = market_data.get('prices', [])
            if len(prices) >= 15:  # Need at least 15 minutes of data
                price_changes = np.diff(prices)
                features.extend([
                    np.mean(price_changes[-1:]),   # 1m price change
                    np.mean(price_changes[-5:]),   # 5m price change
                    np.mean(price_changes[-15:]),  # 15m price change
                ])
            else:
                features.extend([0.0, 0.0, 0.0])
                
            # Volume-based features
            volumes = market_data.get('volumes', [])
            if len(volumes) >= 15:
                volume_changes = np.diff(volumes)
                features.extend([
                    np.mean(volume_changes[-1:]),   # 1m volume change
                    np.mean(volume_changes[-5:]),   # 5m volume change
                    np.mean(volume_changes[-15:]),  # 15m volume change
                ])
            else:
                features.extend([0.0, 0.0, 0.0])
                
            # Market microstructure features
            bid_ask_spread = market_data.get('spread', 0.0)
            liquidity = market_data.get('liquidity', 0.0)
            volatility = np.std(prices[-60:]) if len(prices) >= 60 else 0.0
            
            # Momentum indicators
            if len(prices) >= 20:
                sma_20 = np.mean(prices[-20:])
                momentum = (prices[-1] - sma_20) / sma_20 if sma_20 != 0 else 0.0
            else:
                momentum = 0.0
                
            features.extend([bid_ask_spread, liquidity, volatility, momentum])
            
            # Additional technical indicators
            if len(prices) >= 14:
                # RSI calculation
                deltas = np.diff(prices)
                gains = np.where(deltas > 0, deltas, 0)
                losses = np.where(deltas < 0, -deltas, 0)
                avg_gain = np.mean(gains[-14:])
                avg_loss = np.mean(losses[-14:])
                rs = avg_gain / avg_loss if avg_loss != 0 else 0
                rsi = 100 - (100 / (1 + rs))
                features.append(rsi)
            else:
                features.append(50.0)  # Neutral RSI
                
            # Cross-DEX price differences
            dex_prices = market_data.get('dex_prices', {})
            if len(dex_prices) >= 2:
                price_list = list(dex_prices.values())
                max_price = max(price_list)
                min_price = min(price_list)
                price_spread = (max_price - min_price) / min_price if min_price != 0 else 0.0
                features.append(price_spread)
            else:
                features.append(0.0)
                
            # Time-based features
            now = datetime.now()
            features.extend([
                now.hour / 24.0,  # Hour of day normalized
                now.weekday() / 7.0,  # Day of week normalized
                (now.timestamp() % 3600) / 3600.0  # Minutes within hour normalized
            ])
            
            return np.array(features).reshape(1, -1)
            
        except Exception as e:
            logger.error(f"Error preparing features: {e}")
            # Return zero features as fallback
            return np.zeros((1, len(self.feature_columns) + 5))
            
    def train(self, training_data: List[Dict[str, Any]], validation_split: float = 0.2):
        """Train the model on historical data"""
        try:
            logger.info("Starting model training...")
            
            # Prepare training data
            X, y = self._prepare_training_data(training_data)
            
            if len(X) < 100:
                logger.warning("Insufficient training data. Need at least 100 samples.")
                return False
                
            # Split data
            X_train, X_val, y_train, y_val = train_test_split(
                X, y, test_size=validation_split, random_state=42
            )
            
            # Scale features
            self.scaler = StandardScaler()
            X_train_scaled = self.scaler.fit_transform(X_train)
            X_val_scaled = self.scaler.transform(X_val)
            
            # Create and train model
            self.model = self.create_model(X_train_scaled.shape[1])
            
            # Callbacks
            callbacks = [
                keras.callbacks.EarlyStopping(
                    monitor='val_loss',
                    patience=10,
                    restore_best_weights=True
                ),
                keras.callbacks.ReduceLROnPlateau(
                    monitor='val_loss',
                    factor=0.5,
                    patience=5,
                    min_lr=1e-7
                ),
                keras.callbacks.ModelCheckpoint(
                    filepath=os.path.join(self.model_path, 'best_model.h5'),
                    monitor='val_loss',
                    save_best_only=True
                )
            ]
            
            # Train model
            history = self.model.fit(
                X_train_scaled, y_train,
                validation_data=(X_val_scaled, y_val),
                epochs=config.ml.epochs,
                batch_size=config.ml.batch_size,
                callbacks=callbacks,
                verbose=1
            )
            
            # Evaluate model
            val_loss = self.model.evaluate(X_val_scaled, y_val, verbose=0)
            logger.info(f"Validation loss: {val_loss}")
            
            # Save model and scaler
            self.save_model()
            self.is_trained = True
            
            logger.info("Model training completed successfully")
            return True
            
        except Exception as e:
            logger.error(f"Error during training: {e}")
            return False
            
    def _prepare_training_data(self, training_data: List[Dict[str, Any]]) -> Tuple[np.ndarray, np.ndarray]:
        """Prepare training data from historical records"""
        X, y = [], []
        
        for record in training_data:
            try:
                # Extract features
                features = self.prepare_features(record['market_data']).flatten()
                
                # Extract labels
                profit_probability = record.get('profit_probability', 0.0)
                optimal_amount = record.get('optimal_amount', 0.0)
                risk_score = record.get('risk_score', 0.5)
                
                X.append(features)
                y.append([profit_probability, optimal_amount, risk_score])
                
            except Exception as e:
                logger.warning(f"Skipping invalid training record: {e}")
                continue
                
        return np.array(X), np.array(y)
        
    def predict(self, market_data: Dict[str, Any]) -> Dict[str, float]:
        """Make prediction for flash loan opportunity"""
        try:
            if not self.is_trained or self.model is None:
                if not self.load_model():
                    logger.error("No trained model available")
                    return self._default_prediction()
                    
            # Prepare features
            features = self.prepare_features(market_data)
            
            # Scale features
            if self.scaler is not None:
                features_scaled = self.scaler.transform(features)
            else:
                features_scaled = features
                
            # Make prediction
            prediction = self.model.predict(features_scaled, verbose=0)[0]
            
            return {
                'profit_probability': float(prediction[0]),
                'optimal_amount': float(prediction[1]),
                'risk_score': float(prediction[2]),
                'confidence': self._calculate_confidence(features_scaled)
            }
            
        except Exception as e:
            logger.error(f"Error during prediction: {e}")
            return self._default_prediction()
            
    def _calculate_confidence(self, features: np.ndarray) -> float:
        """Calculate prediction confidence based on feature quality"""
        try:
            # Simple confidence calculation based on feature completeness
            non_zero_features = np.count_nonzero(features)
            total_features = features.size
            confidence = non_zero_features / total_features
            
            # Adjust confidence based on model certainty
            if self.model is not None:
                # Use model's prediction variance as uncertainty measure
                predictions = []
                for _ in range(10):  # Monte Carlo dropout
                    pred = self.model.predict(features, verbose=0)
                    predictions.append(pred)
                    
                predictions = np.array(predictions)
                uncertainty = np.std(predictions, axis=0).mean()
                confidence *= (1.0 - min(uncertainty, 0.5))
                
            return max(0.1, min(1.0, confidence))
            
        except Exception as e:
            logger.error(f"Error calculating confidence: {e}")
            return 0.5
            
    def _default_prediction(self) -> Dict[str, float]:
        """Return default prediction when model is unavailable"""
        return {
            'profit_probability': 0.1,
            'optimal_amount': 1000.0,
            'risk_score': 0.8,
            'confidence': 0.1
        }
        
    def save_model(self):
        """Save trained model and scaler"""
        try:
            if self.model is not None:
                model_file = os.path.join(self.model_path, 'flash_loan_model.h5')
                self.model.save(model_file)
                logger.info(f"Model saved to {model_file}")
                
            if self.scaler is not None:
                scaler_file = os.path.join(self.model_path, 'scaler.pkl')
                joblib.dump(self.scaler, scaler_file)
                logger.info(f"Scaler saved to {scaler_file}")
                
        except Exception as e:
            logger.error(f"Error saving model: {e}")
            
    def load_model(self) -> bool:
        """Load trained model and scaler"""
        try:
            model_file = os.path.join(self.model_path, 'flash_loan_model.h5')
            scaler_file = os.path.join(self.model_path, 'scaler.pkl')
            
            if os.path.exists(model_file):
                self.model = keras.models.load_model(model_file)
                logger.info(f"Model loaded from {model_file}")
                self.is_trained = True
            else:
                logger.warning(f"Model file not found: {model_file}")
                return False
                
            if os.path.exists(scaler_file):
                self.scaler = joblib.load(scaler_file)
                logger.info(f"Scaler loaded from {scaler_file}")
            else:
                logger.warning(f"Scaler file not found: {scaler_file}")
                
            return True
            
        except Exception as e:
            logger.error(f"Error loading model: {e}")
            return False
            
    def update_model(self, new_data: List[Dict[str, Any]]):
        """Update model with new data (online learning)"""
        try:
            if not self.is_trained:
                logger.warning("Cannot update untrained model")
                return False
                
            # Prepare new data
            X_new, y_new = self._prepare_training_data(new_data)
            
            if len(X_new) == 0:
                logger.warning("No valid new data for model update")
                return False
                
            # Scale new features
            if self.scaler is not None:
                X_new_scaled = self.scaler.transform(X_new)
            else:
                X_new_scaled = X_new
                
            # Update model with new data
            self.model.fit(
                X_new_scaled, y_new,
                epochs=5,  # Few epochs for incremental learning
                batch_size=min(32, len(X_new)),
                verbose=0
            )
            
            # Save updated model
            self.save_model()
            
            logger.info(f"Model updated with {len(X_new)} new samples")
            return True
            
        except Exception as e:
            logger.error(f"Error updating model: {e}")
            return False
            
    def get_model_info(self) -> Dict[str, Any]:
        """Get model information and statistics"""
        info = {
            'is_trained': self.is_trained,
            'model_path': self.model_path,
            'feature_columns': self.feature_columns,
            'prediction_window': self.prediction_window
        }
        
        if self.model is not None:
            info.update({
                'model_params': self.model.count_params(),
                'input_shape': self.model.input_shape,
                'output_shape': self.model.output_shape
            })
            
        return info

