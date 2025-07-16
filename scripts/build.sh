#!/bin/bash

# Build script for Limitless Flash Bot
# Builds Anchor program and prepares for deployment

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
    echo -e "${BLUE}[BUILD]${NC} $1"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log "Building Limitless Flash Bot..."

cd "$PROJECT_ROOT"

# Clean previous builds
log "Cleaning previous builds..."
anchor clean

# Build Anchor program
log "Building Anchor program..."
anchor build

# Generate IDL
log "Generating IDL..."
mkdir -p target/idl
anchor idl parse --file programs/flash-loan-system/src/lib.rs > target/idl/flash_loan_system.json

# Install Python dependencies
log "Installing Python dependencies..."
cd off-chain
pip3 install -r requirements.txt

# Copy IDL to off-chain directory
log "Copying IDL to off-chain directory..."
mkdir -p target/idl
cp ../target/idl/flash_loan_system.json target/idl/

cd "$PROJECT_ROOT"

success "Build completed successfully!"
log "Program binary: target/deploy/flash_loan_system.so"
log "IDL file: target/idl/flash_loan_system.json"

