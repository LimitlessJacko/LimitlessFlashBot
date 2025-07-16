#!/bin/bash

# Test script for Limitless Flash Bot
# Runs all tests including Anchor and Python tests

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

log() {
    echo -e "${BLUE}[TEST]${NC} $1"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log "Running Limitless Flash Bot tests..."

cd "$PROJECT_ROOT"

# Build first
log "Building project..."
./scripts/build.sh

# Run Anchor tests
log "Running Anchor tests..."
if anchor test --skip-local-validator; then
    success "Anchor tests passed"
else
    error "Anchor tests failed"
    exit 1
fi

# Run Python tests
log "Running Python tests..."
cd off-chain

# Create test environment
export PYTHONPATH="${PYTHONPATH}:$(pwd)/src"

# Run pytest
if python3 -m pytest tests/ -v --tb=short; then
    success "Python tests passed"
else
    error "Python tests failed"
    exit 1
fi

cd "$PROJECT_ROOT"

# Run integration tests
log "Running integration tests..."
if npm test; then
    success "Integration tests passed"
else
    error "Integration tests failed"
    exit 1
fi

success "All tests passed successfully!"

