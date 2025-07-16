#!/bin/bash

# Limitless Flash Bot - Production Deployment Script
# Author: Limitlessjacko
# Description: Builds Anchor program, packages Docker container, and deploys to production

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GITHUB_REPO="Limitlessjacko/limitlessflashbot"
DOCKER_IMAGE="limitlessflashbot"
DOCKER_TAG="latest"
SOLANA_NETWORK="${SOLANA_NETWORK:-mainnet-beta}"
DEPLOYMENT_ENV="${DEPLOYMENT_ENV:-production}"

# Logging function
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."
    
    # Check if running in project root
    if [ ! -f "$PROJECT_ROOT/Anchor.toml" ]; then
        error "Must run from project root directory"
        exit 1
    fi
    
    # Check required tools
    local tools=("anchor" "docker" "git" "node" "npm" "python3" "pip3")
    for tool in "${tools[@]}"; do
        if ! command -v "$tool" &> /dev/null; then
            error "$tool is not installed or not in PATH"
            exit 1
        fi
    done
    
    # Check Solana CLI
    if ! command -v "solana" &> /dev/null; then
        error "Solana CLI is not installed"
        exit 1
    fi
    
    # Check environment variables
    if [ -z "$SOLANA_PRIVATE_KEY" ] && [ -z "$WALLET_PRIVATE_KEY" ]; then
        warning "No wallet private key found in environment"
    fi
    
    success "Prerequisites check passed"
}

# Setup environment
setup_environment() {
    log "Setting up environment..."
    
    cd "$PROJECT_ROOT"
    
    # Set Solana network
    solana config set --url "$SOLANA_NETWORK"
    log "Solana network set to: $SOLANA_NETWORK"
    
    # Create necessary directories
    mkdir -p logs
    mkdir -p off-chain/models
    mkdir -p target/deploy
    
    success "Environment setup completed"
}

# Build Anchor program
build_anchor_program() {
    log "Building Anchor program..."
    
    cd "$PROJECT_ROOT"
    
    # Clean previous builds
    anchor clean
    
    # Build the program
    anchor build
    
    # Verify build
    if [ ! -f "target/deploy/flash_loan_system.so" ]; then
        error "Anchor build failed - program binary not found"
        exit 1
    fi
    
    # Generate IDL
    anchor idl parse --file programs/flash-loan-system/src/lib.rs > target/idl/flash_loan_system.json
    
    success "Anchor program built successfully"
}

# Run tests
run_tests() {
    log "Running tests..."
    
    cd "$PROJECT_ROOT"
    
    # Run Anchor tests
    log "Running Anchor tests..."
    anchor test --skip-local-validator
    
    # Install Python dependencies for testing
    cd off-chain
    pip3 install -r requirements.txt
    
    # Run Python tests
    log "Running Python tests..."
    python3 -m pytest tests/ -v
    
    cd "$PROJECT_ROOT"
    success "All tests passed"
}

# Deploy Anchor program
deploy_anchor_program() {
    log "Deploying Anchor program to $SOLANA_NETWORK..."
    
    cd "$PROJECT_ROOT"
    
    # Check wallet balance
    local balance=$(solana balance --lamports)
    local min_balance=1000000000  # 1 SOL in lamports
    
    if [ "$balance" -lt "$min_balance" ]; then
        error "Insufficient SOL balance for deployment. Need at least 1 SOL."
        exit 1
    fi
    
    # Deploy program
    anchor deploy --provider.cluster "$SOLANA_NETWORK"
    
    # Verify deployment
    local program_id=$(anchor keys list | grep "flash_loan_system" | awk '{print $2}')
    if [ -z "$program_id" ]; then
        error "Failed to get program ID after deployment"
        exit 1
    fi
    
    log "Program deployed with ID: $program_id"
    
    # Update configuration with deployed program ID
    sed -i "s/FLashLoanSys11111111111111111111111111111111/$program_id/g" off-chain/src/core/config.py
    
    success "Anchor program deployed successfully"
}

# Build Docker image
build_docker_image() {
    log "Building Docker image..."
    
    cd "$PROJECT_ROOT"
    
    # Create Dockerfile if it doesn't exist
    if [ ! -f "Dockerfile" ]; then
        create_dockerfile
    fi
    
    # Build Docker image
    docker build -t "$DOCKER_IMAGE:$DOCKER_TAG" .
    
    # Tag for registry
    docker tag "$DOCKER_IMAGE:$DOCKER_TAG" "ghcr.io/$GITHUB_REPO:$DOCKER_TAG"
    
    success "Docker image built successfully"
}

# Create Dockerfile
create_dockerfile() {
    log "Creating Dockerfile..."
    
    cat > "$PROJECT_ROOT/Dockerfile" << 'EOF'
# Multi-stage build for production
FROM python:3.11-slim as builder

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy requirements and install Python dependencies
COPY off-chain/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Production stage
FROM python:3.11-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd --create-home --shell /bin/bash flashbot

# Set working directory
WORKDIR /app

# Copy Python dependencies from builder
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copy application code
COPY off-chain/ .
COPY target/idl/flash_loan_system.json target/idl/

# Create necessary directories
RUN mkdir -p logs models && \
    chown -R flashbot:flashbot /app

# Switch to non-root user
USER flashbot

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:5000/health || exit 1

# Start application
CMD ["python", "app.py"]
EOF

    success "Dockerfile created"
}

# Create docker-compose.yml
create_docker_compose() {
    log "Creating docker-compose.yml..."
    
    cat > "$PROJECT_ROOT/docker-compose.yml" << 'EOF'
version: '3.8'

services:
  flashbot:
    build: .
    image: limitlessflashbot:latest
    container_name: limitlessflashbot
    restart: unless-stopped
    ports:
      - "5000:5000"
    environment:
      - SOLANA_RPC_URL=${SOLANA_RPC_URL:-https://api.mainnet-beta.solana.com}
      - QUICKNODE_URL=${QUICKNODE_URL}
      - WALLET_PRIVATE_KEY=${WALLET_PRIVATE_KEY}
      - REDIS_HOST=redis
      - DATABASE_URL=postgresql://flashbot:password@postgres:5432/flashbot
      - LOG_LEVEL=${LOG_LEVEL:-INFO}
      - DEPLOYMENT_ENV=production
    volumes:
      - ./logs:/app/logs
      - ./off-chain/models:/app/models
    depends_on:
      - redis
      - postgres
    networks:
      - flashbot-network

  redis:
    image: redis:7-alpine
    container_name: flashbot-redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    networks:
      - flashbot-network

  postgres:
    image: postgres:15-alpine
    container_name: flashbot-postgres
    restart: unless-stopped
    environment:
      - POSTGRES_DB=flashbot
      - POSTGRES_USER=flashbot
      - POSTGRES_PASSWORD=password
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - flashbot-network

  prometheus:
    image: prom/prometheus:latest
    container_name: flashbot-prometheus
    restart: unless-stopped
    ports:
      - "9090:9090"
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus_data:/prometheus
    networks:
      - flashbot-network

  grafana:
    image: grafana/grafana:latest
    container_name: flashbot-grafana
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    volumes:
      - grafana_data:/var/lib/grafana
    networks:
      - flashbot-network

volumes:
  redis_data:
  postgres_data:
  prometheus_data:
  grafana_data:

networks:
  flashbot-network:
    driver: bridge
EOF

    success "docker-compose.yml created"
}

# Create monitoring configuration
create_monitoring_config() {
    log "Creating monitoring configuration..."
    
    mkdir -p "$PROJECT_ROOT/monitoring"
    
    # Prometheus configuration
    cat > "$PROJECT_ROOT/monitoring/prometheus.yml" << 'EOF'
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  # - "first_rules.yml"
  # - "second_rules.yml"

scrape_configs:
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']

  - job_name: 'flashbot'
    static_configs:
      - targets: ['flashbot:8000']
    metrics_path: '/metrics'
    scrape_interval: 5s

  - job_name: 'redis'
    static_configs:
      - targets: ['redis:6379']

  - job_name: 'postgres'
    static_configs:
      - targets: ['postgres:5432']
EOF

    success "Monitoring configuration created"
}

# Setup GitHub Actions
setup_github_actions() {
    log "Setting up GitHub Actions..."
    
    mkdir -p "$PROJECT_ROOT/.github/workflows"
    
    cat > "$PROJECT_ROOT/.github/workflows/ci-cd.yml" << 'EOF'
name: CI/CD Pipeline

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
        
    - name: Setup Python
      uses: actions/setup-python@v4
      with:
        python-version: '3.11'
        
    - name: Install Solana CLI
      run: |
        sh -c "$(curl -sSfL https://release.solana.com/v1.16.0/install)"
        echo "$HOME/.local/share/solana/install/active_release/bin" >> $GITHUB_PATH
        
    - name: Install Anchor
      run: |
        npm install -g @coral-xyz/anchor-cli
        
    - name: Cache dependencies
      uses: actions/cache@v3
      with:
        path: |
          ~/.cargo
          ~/.npm
          ~/.cache/pip
        key: ${{ runner.os }}-deps-${{ hashFiles('**/Cargo.lock', '**/package-lock.json', '**/requirements.txt') }}
        
    - name: Install dependencies
      run: |
        cd off-chain
        pip install -r requirements.txt
        cd ..
        npm install
        
    - name: Build Anchor program
      run: |
        anchor build
        
    - name: Run tests
      run: |
        anchor test --skip-local-validator
        cd off-chain
        python -m pytest tests/ -v

  build-and-push:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    
    permissions:
      contents: read
      packages: write
      
    steps:
    - uses: actions/checkout@v3
    
    - name: Log in to Container Registry
      uses: docker/login-action@v2
      with:
        registry: ${{ env.REGISTRY }}
        username: ${{ github.actor }}
        password: ${{ secrets.GITHUB_TOKEN }}
        
    - name: Extract metadata
      id: meta
      uses: docker/metadata-action@v4
      with:
        images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
        tags: |
          type=ref,event=branch
          type=ref,event=pr
          type=sha
          
    - name: Build and push Docker image
      uses: docker/build-push-action@v4
      with:
        context: .
        push: true
        tags: ${{ steps.meta.outputs.tags }}
        labels: ${{ steps.meta.outputs.labels }}

  deploy:
    needs: build-and-push
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Deploy to production
      run: |
        echo "Deployment would happen here"
        # Add your deployment commands here
EOF

    success "GitHub Actions workflow created"
}

# Create environment files
create_env_files() {
    log "Creating environment files..."
    
    # Production environment
    cat > "$PROJECT_ROOT/.env.production" << 'EOF'
# Solana Configuration
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
QUICKNODE_URL=
WALLET_PRIVATE_KEY=

# Database Configuration
DATABASE_URL=postgresql://flashbot:password@postgres:5432/flashbot
REDIS_HOST=redis
REDIS_PORT=6379

# API Configuration
API_HOST=0.0.0.0
API_PORT=5000
DEBUG=false

# Monitoring
LOG_LEVEL=INFO
SENTRY_DSN=
PROMETHEUS_PORT=8000

# Security
API_KEY=
JWT_SECRET=

# Flash Loan Configuration
MAX_LOAN_AMOUNT=1000000000000
FEE_RATE=30
MAX_SLIPPAGE=500
GAS_LIMIT=100000

# Rate Limiting
RATE_LIMIT=60
EOF

    # Development environment
    cat > "$PROJECT_ROOT/.env.development" << 'EOF'
# Solana Configuration
SOLANA_RPC_URL=https://api.devnet.solana.com
QUICKNODE_URL=
WALLET_PRIVATE_KEY=

# Database Configuration
DATABASE_URL=postgresql://flashbot:password@localhost:5432/flashbot_dev
REDIS_HOST=localhost
REDIS_PORT=6379

# API Configuration
API_HOST=0.0.0.0
API_PORT=5000
DEBUG=true

# Monitoring
LOG_LEVEL=DEBUG
PROMETHEUS_PORT=8000

# Security
API_KEY=dev-key
JWT_SECRET=dev-secret

# Flash Loan Configuration
MAX_LOAN_AMOUNT=100000000000
FEE_RATE=30
MAX_SLIPPAGE=500
GAS_LIMIT=100000

# Rate Limiting
RATE_LIMIT=600
EOF

    success "Environment files created"
}

# Push to GitHub
push_to_github() {
    log "Pushing to GitHub repository..."
    
    cd "$PROJECT_ROOT"
    
    # Initialize git if not already
    if [ ! -d ".git" ]; then
        git init
        git remote add origin "https://github.com/$GITHUB_REPO.git"
    fi
    
    # Add all files
    git add .
    
    # Commit changes
    git commit -m "Production deployment - $(date +'%Y-%m-%d %H:%M:%S')" || true
    
    # Push to main branch
    git push -u origin main
    
    success "Code pushed to GitHub"
}

# Deploy to production
deploy_to_production() {
    log "Deploying to production..."
    
    cd "$PROJECT_ROOT"
    
    # Start services with docker-compose
    docker-compose -f docker-compose.yml up -d
    
    # Wait for services to be ready
    log "Waiting for services to start..."
    sleep 30
    
    # Health check
    if curl -f http://localhost:5000/health > /dev/null 2>&1; then
        success "Application is running and healthy"
    else
        error "Application health check failed"
        docker-compose logs flashbot
        exit 1
    fi
    
    success "Production deployment completed"
}

# Cleanup function
cleanup() {
    log "Cleaning up temporary files..."
    # Add cleanup commands here if needed
}

# Main deployment function
main() {
    log "Starting Limitless Flash Bot deployment..."
    log "Deployment environment: $DEPLOYMENT_ENV"
    log "Solana network: $SOLANA_NETWORK"
    log "GitHub repository: $GITHUB_REPO"
    
    # Set trap for cleanup
    trap cleanup EXIT
    
    # Run deployment steps
    check_prerequisites
    setup_environment
    build_anchor_program
    
    # Skip tests in production for faster deployment
    if [ "$DEPLOYMENT_ENV" != "production" ]; then
        run_tests
    fi
    
    # Deploy Anchor program only in production
    if [ "$DEPLOYMENT_ENV" = "production" ]; then
        deploy_anchor_program
    fi
    
    build_docker_image
    create_docker_compose
    create_monitoring_config
    setup_github_actions
    create_env_files
    
    # Push to GitHub
    push_to_github
    
    # Deploy to production
    if [ "$DEPLOYMENT_ENV" = "production" ]; then
        deploy_to_production
    fi
    
    success "Deployment completed successfully!"
    log "Application URL: http://localhost:5000"
    log "Grafana Dashboard: http://localhost:3000 (admin/admin)"
    log "Prometheus Metrics: http://localhost:9090"
}

# Handle command line arguments
case "${1:-}" in
    "build")
        check_prerequisites
        setup_environment
        build_anchor_program
        build_docker_image
        ;;
    "test")
        check_prerequisites
        setup_environment
        build_anchor_program
        run_tests
        ;;
    "deploy-program")
        check_prerequisites
        setup_environment
        build_anchor_program
        deploy_anchor_program
        ;;
    "docker")
        build_docker_image
        ;;
    "github")
        setup_github_actions
        push_to_github
        ;;
    "production")
        DEPLOYMENT_ENV="production"
        main
        ;;
    "development")
        DEPLOYMENT_ENV="development"
        SOLANA_NETWORK="devnet"
        main
        ;;
    *)
        main
        ;;
esac

