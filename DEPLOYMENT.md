# LimitlessFlashBot Deployment Guide

This guide provides step-by-step instructions for deploying the LimitlessFlashBot to production on Ethereum mainnet.

## 🚀 Quick Deployment

### Prerequisites Checklist

Before deploying, ensure you have:

- [ ] **Ethereum Wallet** with sufficient ETH for gas fees (minimum 0.1 ETH recommended)
- [ ] **Private Key** exported from your wallet (64 hex characters)
- [ ] **RPC Endpoints** from QuickNode, Infura, or Alchemy
- [ ] **Etherscan API Key** for contract verification
- [ ] **VPS or Cloud Server** for running the executor (2+ CPU cores, 4GB+ RAM)
- [ ] **Domain Name** (optional) for custom dashboard URL

### 1. Environment Setup

Clone the repository and configure environment variables:

```bash
# Clone the repository
git clone https://github.com/username/LimitlessFlashBot.git
cd LimitlessFlashBot

# Copy environment template
cp .env.example .env

# Edit configuration
nano .env
```

**Critical Environment Variables:**

```bash
# Wallet Configuration
PRIVATE_KEY=your_64_character_private_key_without_0x_prefix
PROFIT_WALLET=0xDe32ebF443f213E6b904461FfBE3e107b93CE3Bc

# RPC Endpoints (choose at least one)
QUICKNODE_RPC=https://your-quicknode-endpoint.com
INFURA_RPC=https://mainnet.infura.io/v3/your-project-id
ALCHEMY_RPC=https://eth-mainnet.alchemyapi.io/v2/your-api-key

# API Keys
ETHERSCAN_API_KEY=your_etherscan_api_key
FLASHBOTS_RPC=https://relay.flashbots.net

# Trading Parameters
MAX_LIQUIDITY_UTILIZATION=0.90
MIN_PROFIT_THRESHOLD=0.001
MAX_GAS_PRICE=100
```

### 2. Automated Deployment (Recommended)

The project includes GitHub Actions for automated deployment:

#### Setup GitHub Secrets

1. Fork the repository to your GitHub account
2. Go to Settings → Secrets and Variables → Actions
3. Add the following secrets:

```
MAINNET_PRIVATE_KEY=your_private_key
QUICKNODE_RPC=your_rpc_endpoint
ETHERSCAN_API_KEY=your_etherscan_key
PROFIT_WALLET=0xDe32ebF443f213E6b904461FfBE3e107b93CE3Bc
CLOUDFLARE_API_TOKEN=your_cloudflare_token
VPS_HOST=your.vps.ip.address
VPS_USERNAME=ubuntu
VPS_SSH_KEY=your_private_ssh_key
```

#### Deploy via GitHub Actions

```bash
# Push to main branch to trigger deployment
git add .
git commit -m "feat: initial deployment"
git push origin main
```

The CI/CD pipeline will automatically:
- ✅ Run comprehensive tests
- ✅ Deploy smart contracts to mainnet
- ✅ Verify contracts on Etherscan
- ✅ Deploy frontend to Cloudflare Pages
- ✅ Deploy executor to VPS
- ✅ Run smoke tests

### 3. Manual Deployment

If you prefer manual deployment:

#### Step 3.1: Deploy Smart Contracts

```bash
cd contracts

# Install dependencies
npm install --legacy-peer-deps

# Deploy to mainnet
npm run deploy:mainnet

# Verify on Etherscan
npm run verify:mainnet

# Save contract address
echo "CONTRACT_ADDRESS=$(cat deployments/mainnet.json | jq -r '.address')" >> ../.env
```

#### Step 3.2: Deploy Frontend Dashboard

```bash
cd web/limitless-flash-dashboard

# Install dependencies
npm install

# Build for production
npm run build

# Deploy to Cloudflare Pages (or your preferred hosting)
# Follow your hosting provider's instructions
```

#### Step 3.3: Deploy Executor to VPS

```bash
# Copy files to VPS
scp -r . user@your-vps-ip:/opt/limitless-flash-bot/

# SSH to VPS and run deployment script
ssh user@your-vps-ip
cd /opt/limitless-flash-bot
sudo bash scripts/deploy-vps.sh
```

## 🔧 Production Configuration

### VPS Setup

#### Recommended Specifications

- **Provider**: Vultr, DigitalOcean, or AWS
- **CPU**: 2+ cores (4+ recommended)
- **RAM**: 4GB minimum (8GB+ recommended)
- **Storage**: 50GB SSD
- **Network**: 1Gbps with low latency to Ethereum nodes
- **Location**: US East Coast or Europe (close to Ethereum infrastructure)

#### Server Configuration

The deployment script automatically configures:

```bash
# System updates and security
sudo apt update && sudo apt upgrade -y
sudo ufw enable
sudo fail2ban-client start

# Node.js and PM2
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2

# Nginx reverse proxy
sudo apt install nginx
sudo systemctl enable nginx

# SSL certificate (Let's Encrypt)
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

### Security Hardening

#### Firewall Configuration

```bash
# Allow only necessary ports
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

#### Process Management

```bash
# Start executor with PM2
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup
```

#### Monitoring Setup

```bash
# Install monitoring tools
sudo apt install htop iotop nethogs

# Setup log rotation
sudo logrotate -d /etc/logrotate.d/limitless-flash-bot
```

## 📊 Post-Deployment Verification

### 1. Run Smoke Tests

```bash
cd scripts
node smoke-test.js
```

Expected output:
```
🚀 Starting LimitlessFlashBot Smoke Tests...
✅ Network Connectivity
✅ Contract Deployment
✅ Contract Ownership
✅ Contract Profit Wallet
✅ Wallet Balance
✅ Executor API Health
✅ Frontend Access
🎉 All smoke tests passed! Deployment is healthy.
```

### 2. Verify Dashboard Access

Visit your dashboard URL and verify:
- [ ] Dashboard loads without errors
- [ ] Real-time data is displayed
- [ ] Bot controls are functional
- [ ] Transaction history is accessible

### 3. Monitor Initial Performance

```bash
# Check executor logs
pm2 logs limitless-flash-bot

# Monitor system resources
htop

# Check network connectivity
ping -c 5 mainnet.infura.io
```

## 🚨 Troubleshooting

### Common Issues

#### Contract Deployment Fails

```bash
# Check wallet balance
curl -s "https://api.etherscan.io/api?module=account&action=balance&address=YOUR_ADDRESS&tag=latest&apikey=$ETHERSCAN_API_KEY"

# Check gas prices
curl -s "https://api.etherscan.io/api?module=gastracker&action=gasoracle&apikey=$ETHERSCAN_API_KEY"

# Retry with higher gas price
npm run deploy:mainnet -- --gas-price 50
```

#### Executor Not Starting

```bash
# Check environment variables
cd executor
npm run config:validate

# Check dependencies
npm run deps:check

# View detailed logs
tail -f logs/error.log
```

#### Dashboard Not Loading

```bash
# Check build status
cd web/limitless-flash-dashboard
npm run build

# Test locally
npm run dev

# Check deployment logs
# (varies by hosting provider)
```

### Emergency Procedures

#### Stop Bot Immediately

```bash
# Via API
curl -X POST -H "X-API-Key: $API_KEY" http://your-executor-url/stop

# Via PM2
pm2 stop limitless-flash-bot

# Emergency contract pause (if implemented)
cd contracts
npx hardhat run scripts/emergency-pause.js --network mainnet
```

#### Withdraw Funds

```bash
# Check contract balance
npx hardhat run scripts/check-balance.js --network mainnet

# Emergency withdrawal (if implemented)
npx hardhat run scripts/emergency-withdraw.js --network mainnet
```

## 📈 Optimization

### Performance Tuning

#### RPC Optimization

```bash
# Use multiple RPC endpoints for redundancy
RPC_ENDPOINTS=endpoint1,endpoint2,endpoint3

# Enable connection pooling
RPC_POOL_SIZE=10
```

#### Gas Optimization

```bash
# Dynamic gas pricing
DYNAMIC_GAS_PRICING=true
GAS_PRICE_MULTIPLIER=1.1

# Gas limit optimization
OPTIMIZE_GAS_LIMIT=true
```

#### Quantum Model Updates

```bash
# Schedule regular model updates
echo "0 */6 * * * cd /opt/limitless-flash-bot/executor && npm run update-models" | crontab -
```

### Scaling Considerations

#### Multi-Instance Deployment

```bash
# Run multiple executor instances
pm2 start ecosystem.config.js -i 2

# Load balancer configuration
# (configure Nginx upstream)
```

#### Database Optimization

```bash
# Migrate to PostgreSQL for better performance
npm run db:migrate:postgres

# Enable query optimization
DATABASE_QUERY_CACHE=true
```

## 🔄 Maintenance

### Regular Tasks

#### Daily
- [ ] Check bot performance metrics
- [ ] Review transaction logs
- [ ] Monitor wallet balance
- [ ] Verify system health

#### Weekly
- [ ] Update quantum models
- [ ] Review and optimize gas settings
- [ ] Check for software updates
- [ ] Backup configuration and data

#### Monthly
- [ ] Security audit and updates
- [ ] Performance optimization review
- [ ] Profit analysis and strategy adjustment
- [ ] Infrastructure cost optimization

### Update Procedures

#### Code Updates

```bash
# Pull latest changes
git pull origin main

# Update dependencies
npm run update:all

# Restart services
pm2 restart all
```

#### Model Updates

```bash
# Update quantum models
cd executor
npm run update-models

# Restart executor
pm2 restart limitless-flash-bot
```

## 📞 Support

### Getting Help

- **GitHub Issues**: Report bugs and request features
- **Documentation**: Comprehensive guides and API reference
- **Community**: Discord and Telegram channels
- **Professional Support**: 24/7 support for production deployments

### Emergency Contacts

- **Critical Issues**: emergency@limitlessflashbot.com
- **Security Issues**: security@limitlessflashbot.com
- **General Support**: support@limitlessflashbot.com

---

**Congratulations!** 🎉 Your LimitlessFlashBot is now deployed and ready to start earning profits through automated flash loan arbitrage with quantum-enhanced signals and MEV protection.

Remember to monitor the bot regularly and keep your systems updated for optimal performance and security.

