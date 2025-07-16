# Deployment Guide

This guide covers deploying the Limitless Flash Bot system to production environments.

## Prerequisites

### System Requirements
- Linux server (Ubuntu 20.04+ recommended)
- Minimum 8GB RAM, 16GB recommended
- 50GB+ storage space
- Stable internet connection with low latency

### Required Software
- Docker and Docker Compose
- Git
- SSL certificates (for HTTPS)

### Solana Requirements
- Funded Solana wallet
- QuickNode or similar RPC endpoint
- Program deployment permissions

## Quick Deployment

### 1. Server Setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/download/v2.20.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Logout and login to apply docker group changes
```

### 2. Clone and Configure

```bash
# Clone repository
git clone https://github.com/Limitlessjacko/limitlessflashbot.git
cd limitlessflashbot

# Copy environment file
cp .env.example .env

# Edit configuration
nano .env
```

### 3. Deploy

```bash
# Deploy to production
./scripts/deploy.sh production
```

## Manual Deployment

### 1. Environment Configuration

Create production environment file:

```bash
# .env.production
SOLANA_RPC_URL=https://your-quicknode-endpoint.com
QUICKNODE_URL=https://your-quicknode-endpoint.com
WALLET_PRIVATE_KEY=your_base58_private_key

# Database
DATABASE_URL=postgresql://flashbot:secure_password@postgres:5432/flashbot
REDIS_HOST=redis
POSTGRES_PASSWORD=secure_password

# Security
API_KEY=your_secure_api_key
JWT_SECRET=your_jwt_secret

# Production settings
DEBUG=false
LOG_LEVEL=INFO
DEPLOYMENT_ENV=production
```

### 2. SSL Configuration

Set up SSL certificates:

```bash
# Create SSL directory
mkdir -p nginx/ssl

# Generate self-signed certificate (for testing)
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout nginx/ssl/flashbot.key \
  -out nginx/ssl/flashbot.crt

# Or copy your SSL certificates
cp your_certificate.crt nginx/ssl/flashbot.crt
cp your_private_key.key nginx/ssl/flashbot.key
```

### 3. Nginx Configuration

Create nginx configuration:

```nginx
# nginx/nginx.conf
events {
    worker_connections 1024;
}

http {
    upstream flashbot {
        server flashbot:5000;
    }

    server {
        listen 80;
        server_name your-domain.com;
        return 301 https://$server_name$request_uri;
    }

    server {
        listen 443 ssl;
        server_name your-domain.com;

        ssl_certificate /etc/nginx/ssl/flashbot.crt;
        ssl_certificate_key /etc/nginx/ssl/flashbot.key;

        location / {
            proxy_pass http://flashbot;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        location /ws {
            proxy_pass http://flashbot;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
        }
    }
}
```

### 4. Database Initialization

Create database initialization script:

```sql
-- scripts/init-db.sql
CREATE DATABASE flashbot;
CREATE USER flashbot WITH PASSWORD 'secure_password';
GRANT ALL PRIVILEGES ON DATABASE flashbot TO flashbot;

-- Create tables
\c flashbot;

CREATE TABLE transactions (
    id SERIAL PRIMARY KEY,
    signature VARCHAR(88) UNIQUE NOT NULL,
    type VARCHAR(50) NOT NULL,
    token_pair VARCHAR(20) NOT NULL,
    amount BIGINT NOT NULL,
    expected_profit DECIMAL(20, 8),
    actual_profit DECIMAL(20, 8),
    status VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    confirmed_at TIMESTAMP
);

CREATE TABLE opportunities (
    id SERIAL PRIMARY KEY,
    type VARCHAR(50) NOT NULL,
    token_pair VARCHAR(20) NOT NULL,
    amount BIGINT NOT NULL,
    expected_profit DECIMAL(20, 8),
    risk_score DECIMAL(5, 4),
    ml_confidence DECIMAL(5, 4),
    executed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE dex_prices (
    id SERIAL PRIMARY KEY,
    dex VARCHAR(50) NOT NULL,
    token_pair VARCHAR(20) NOT NULL,
    price DECIMAL(20, 8) NOT NULL,
    volume_24h BIGINT,
    liquidity BIGINT,
    spread DECIMAL(10, 8),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_transactions_signature ON transactions(signature);
CREATE INDEX idx_transactions_created_at ON transactions(created_at);
CREATE INDEX idx_opportunities_created_at ON opportunities(created_at);
CREATE INDEX idx_dex_prices_timestamp ON dex_prices(timestamp);
CREATE INDEX idx_dex_prices_dex_pair ON dex_prices(dex, token_pair);
```

### 5. Monitoring Configuration

Create Prometheus configuration:

```yaml
# monitoring/prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - "alert_rules.yml"

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
      - targets: ['redis_exporter:9121']

  - job_name: 'postgres'
    static_configs:
      - targets: ['postgres_exporter:9187']

  - job_name: 'nginx'
    static_configs:
      - targets: ['nginx_exporter:9113']

alerting:
  alertmanagers:
    - static_configs:
        - targets:
          - alertmanager:9093
```

### 6. Deploy Services

```bash
# Start all services
docker-compose -f docker-compose.yml up -d

# Check service status
docker-compose ps

# View logs
docker-compose logs -f flashbot
```

## Production Optimizations

### 1. Performance Tuning

#### Database Optimization
```sql
-- PostgreSQL configuration
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET effective_cache_size = '1GB';
ALTER SYSTEM SET maintenance_work_mem = '64MB';
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET wal_buffers = '16MB';
ALTER SYSTEM SET default_statistics_target = 100;
SELECT pg_reload_conf();
```

#### Redis Configuration
```redis
# redis.conf
maxmemory 512mb
maxmemory-policy allkeys-lru
save 900 1
save 300 10
save 60 10000
```

### 2. Security Hardening

#### Firewall Configuration
```bash
# UFW firewall setup
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

#### Docker Security
```yaml
# docker-compose.override.yml
version: '3.8'
services:
  flashbot:
    security_opt:
      - no-new-privileges:true
    read_only: true
    tmpfs:
      - /tmp
    user: "1000:1000"
```

### 3. Backup Strategy

#### Database Backup
```bash
#!/bin/bash
# scripts/backup-db.sh
BACKUP_DIR="/backups"
DATE=$(date +%Y%m%d_%H%M%S)

# Create backup
docker exec flashbot-postgres pg_dump -U flashbot flashbot > "$BACKUP_DIR/flashbot_$DATE.sql"

# Compress backup
gzip "$BACKUP_DIR/flashbot_$DATE.sql"

# Remove old backups (keep 7 days)
find "$BACKUP_DIR" -name "flashbot_*.sql.gz" -mtime +7 -delete
```

#### Configuration Backup
```bash
#!/bin/bash
# scripts/backup-config.sh
tar -czf "/backups/config_$(date +%Y%m%d).tar.gz" \
  .env \
  docker-compose.yml \
  nginx/ \
  monitoring/
```

## Monitoring and Alerting

### 1. Health Checks

Create health check script:

```bash
#!/bin/bash
# scripts/health-check.sh
API_URL="https://your-domain.com"
API_KEY="your_api_key"

# Check API health
response=$(curl -s -H "X-API-Key: $API_KEY" "$API_URL/health")
status=$(echo "$response" | jq -r '.status')

if [ "$status" != "healthy" ]; then
    echo "ALERT: API health check failed"
    # Send alert (email, Slack, etc.)
fi

# Check database connection
if ! docker exec flashbot-postgres pg_isready -U flashbot; then
    echo "ALERT: Database connection failed"
fi

# Check Redis connection
if ! docker exec flashbot-redis redis-cli ping; then
    echo "ALERT: Redis connection failed"
fi
```

### 2. Log Management

Configure log rotation:

```bash
# /etc/logrotate.d/flashbot
/var/lib/docker/containers/*/*-json.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0644 root root
    postrotate
        docker kill --signal=USR1 $(docker ps -q)
    endscript
}
```

### 3. Alerting Rules

Create Prometheus alerting rules:

```yaml
# monitoring/alert_rules.yml
groups:
  - name: flashbot_alerts
    rules:
      - alert: FlashBotDown
        expr: up{job="flashbot"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Flash Bot is down"
          description: "Flash Bot has been down for more than 1 minute"

      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.1
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "High error rate detected"

      - alert: LowWalletBalance
        expr: wallet_balance_sol < 0.5
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "Low wallet balance"
          description: "Wallet balance is below 0.5 SOL"
```

## Scaling

### 1. Horizontal Scaling

For high-volume operations, deploy multiple instances:

```yaml
# docker-compose.scale.yml
version: '3.8'
services:
  flashbot:
    deploy:
      replicas: 3
    environment:
      - INSTANCE_ID=${HOSTNAME}
      
  nginx:
    depends_on:
      - flashbot
    volumes:
      - ./nginx/nginx-lb.conf:/etc/nginx/nginx.conf
```

### 2. Load Balancer Configuration

```nginx
# nginx/nginx-lb.conf
upstream flashbot_backend {
    least_conn;
    server flashbot_1:5000;
    server flashbot_2:5000;
    server flashbot_3:5000;
}

server {
    listen 443 ssl;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://flashbot_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Troubleshooting

### Common Issues

#### 1. Program Deployment Fails
```bash
# Check wallet balance
solana balance

# Check network connection
solana cluster-version

# Verify program build
anchor build
ls -la target/deploy/
```

#### 2. Database Connection Issues
```bash
# Check database logs
docker logs flashbot-postgres

# Test connection
docker exec -it flashbot-postgres psql -U flashbot -d flashbot

# Reset database
docker-compose down -v
docker-compose up -d postgres
```

#### 3. High Memory Usage
```bash
# Check container stats
docker stats

# Optimize Python memory
export PYTHONOPTIMIZE=1
export PYTHONDONTWRITEBYTECODE=1

# Tune garbage collection
export PYTHONHASHSEED=0
```

### Log Analysis

```bash
# View application logs
docker logs flashbot-app --tail=100 -f

# Search for errors
docker logs flashbot-app 2>&1 | grep ERROR

# Monitor resource usage
docker exec flashbot-app top
```

## Maintenance

### Regular Tasks

#### Daily
- Check system health
- Monitor wallet balance
- Review error logs
- Verify backup completion

#### Weekly
- Update dependencies
- Analyze performance metrics
- Review security logs
- Test disaster recovery

#### Monthly
- Security audit
- Performance optimization
- Capacity planning
- Documentation updates

### Update Procedure

```bash
# 1. Backup current deployment
./scripts/backup-config.sh

# 2. Pull latest changes
git pull origin main

# 3. Build new images
docker-compose build

# 4. Deploy with zero downtime
docker-compose up -d --no-deps flashbot

# 5. Verify deployment
curl -H "X-API-Key: $API_KEY" https://your-domain.com/health
```

This deployment guide ensures a robust, secure, and scalable production deployment of the Limitless Flash Bot system.

