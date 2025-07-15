#!/bin/bash

# LimitlessFlashBot VPS Deployment Script
# This script sets up the executor on a Vultr VPS

set -e

echo "🚀 Starting LimitlessFlashBot VPS Deployment..."

# Configuration
PROJECT_DIR="/opt/limitless-flash-bot"
SERVICE_USER="flashbot"
NODE_VERSION="18"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   log_error "This script must be run as root"
   exit 1
fi

# Update system
log_info "Updating system packages..."
apt update && apt upgrade -y

# Install required packages
log_info "Installing required packages..."
apt install -y curl wget git nginx certbot python3-certbot-nginx ufw fail2ban htop

# Install Node.js
log_info "Installing Node.js ${NODE_VERSION}..."
curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
apt install -y nodejs

# Install Python and pip
log_info "Installing Python and dependencies..."
apt install -y python3 python3-pip python3-venv

# Install PM2 globally
log_info "Installing PM2..."
npm install -g pm2

# Create service user
log_info "Creating service user..."
if ! id "$SERVICE_USER" &>/dev/null; then
    useradd -r -s /bin/bash -d /home/$SERVICE_USER -m $SERVICE_USER
    usermod -aG sudo $SERVICE_USER
fi

# Create project directory
log_info "Setting up project directory..."
mkdir -p $PROJECT_DIR
chown -R $SERVICE_USER:$SERVICE_USER $PROJECT_DIR

# Clone repository (if not exists)
if [ ! -d "$PROJECT_DIR/.git" ]; then
    log_info "Cloning repository..."
    sudo -u $SERVICE_USER git clone https://github.com/username/LimitlessFlashBot.git $PROJECT_DIR
else
    log_info "Updating repository..."
    cd $PROJECT_DIR
    sudo -u $SERVICE_USER git pull origin main
fi

# Install executor dependencies
log_info "Installing executor dependencies..."
cd $PROJECT_DIR/executor
sudo -u $SERVICE_USER npm install --production

# Install Python dependencies
log_info "Installing Python dependencies..."
sudo -u $SERVICE_USER python3 -m pip install --user -r python/requirements.txt

# Create environment file
log_info "Creating environment configuration..."
if [ ! -f "$PROJECT_DIR/.env" ]; then
    cp $PROJECT_DIR/.env.example $PROJECT_DIR/.env
    chown $SERVICE_USER:$SERVICE_USER $PROJECT_DIR/.env
    chmod 600 $PROJECT_DIR/.env
    
    log_warn "Please edit $PROJECT_DIR/.env with your configuration"
    log_warn "Required variables: PRIVATE_KEY, QUICKNODE_RPC, ETHERSCAN_API_KEY, etc."
fi

# Create logs directory
log_info "Creating logs directory..."
mkdir -p $PROJECT_DIR/executor/logs
chown -R $SERVICE_USER:$SERVICE_USER $PROJECT_DIR/executor/logs

# Setup PM2 ecosystem file
log_info "Setting up PM2 configuration..."
cat > $PROJECT_DIR/ecosystem.config.js << EOF
module.exports = {
  apps: [{
    name: 'limitless-flash-bot',
    script: './executor/index.js',
    cwd: '$PROJECT_DIR',
    user: '$SERVICE_USER',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './executor/logs/error.log',
    out_file: './executor/logs/out.log',
    log_file: './executor/logs/combined.log',
    time: true,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s'
  }]
};
EOF

chown $SERVICE_USER:$SERVICE_USER $PROJECT_DIR/ecosystem.config.js

# Setup Nginx configuration
log_info "Setting up Nginx..."
cat > /etc/nginx/sites-available/limitless-flash-bot << EOF
server {
    listen 80;
    server_name your-domain.com;  # Replace with your domain
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
    
    location /health {
        proxy_pass http://localhost:3000/health;
        access_log off;
    }
}
EOF

# Enable Nginx site
ln -sf /etc/nginx/sites-available/limitless-flash-bot /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test Nginx configuration
nginx -t

# Setup firewall
log_info "Configuring firewall..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 'Nginx Full'
ufw --force enable

# Setup fail2ban
log_info "Configuring fail2ban..."
cat > /etc/fail2ban/jail.local << EOF
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 3

[sshd]
enabled = true
port = ssh
logpath = %(sshd_log)s
backend = %(sshd_backend)s

[nginx-http-auth]
enabled = true
port = http,https
logpath = /var/log/nginx/error.log

[nginx-limit-req]
enabled = true
port = http,https
logpath = /var/log/nginx/error.log
maxretry = 10
EOF

systemctl enable fail2ban
systemctl restart fail2ban

# Start services
log_info "Starting services..."
systemctl enable nginx
systemctl restart nginx

# Setup PM2 startup
log_info "Setting up PM2 startup..."
sudo -u $SERVICE_USER bash -c "cd $PROJECT_DIR && pm2 start ecosystem.config.js"
sudo -u $SERVICE_USER pm2 save
pm2 startup systemd -u $SERVICE_USER --hp /home/$SERVICE_USER

# Create monitoring script
log_info "Creating monitoring script..."
cat > /usr/local/bin/flashbot-monitor << 'EOF'
#!/bin/bash

# LimitlessFlashBot Monitoring Script

PROJECT_DIR="/opt/limitless-flash-bot"
SERVICE_USER="flashbot"
LOG_FILE="/var/log/flashbot-monitor.log"

log_message() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" >> $LOG_FILE
}

# Check if PM2 process is running
if ! sudo -u $SERVICE_USER pm2 list | grep -q "limitless-flash-bot.*online"; then
    log_message "ERROR: LimitlessFlashBot is not running, attempting restart..."
    sudo -u $SERVICE_USER bash -c "cd $PROJECT_DIR && pm2 restart limitless-flash-bot"
    
    # Send alert (configure with your notification system)
    # curl -X POST -H 'Content-type: application/json' \
    #   --data '{"text":"🚨 LimitlessFlashBot restarted on VPS"}' \
    #   $SLACK_WEBHOOK_URL
fi

# Check disk space
DISK_USAGE=$(df / | awk 'NR==2 {print $5}' | sed 's/%//')
if [ $DISK_USAGE -gt 80 ]; then
    log_message "WARNING: Disk usage is ${DISK_USAGE}%"
fi

# Check memory usage
MEMORY_USAGE=$(free | awk 'NR==2{printf "%.0f", $3*100/$2}')
if [ $MEMORY_USAGE -gt 80 ]; then
    log_message "WARNING: Memory usage is ${MEMORY_USAGE}%"
fi

# Rotate logs if they get too large
find $PROJECT_DIR/executor/logs -name "*.log" -size +100M -exec truncate -s 0 {} \;

log_message "Health check completed"
EOF

chmod +x /usr/local/bin/flashbot-monitor

# Setup cron job for monitoring
log_info "Setting up monitoring cron job..."
(crontab -l 2>/dev/null; echo "*/5 * * * * /usr/local/bin/flashbot-monitor") | crontab -

# Create backup script
log_info "Creating backup script..."
cat > /usr/local/bin/flashbot-backup << EOF
#!/bin/bash

# LimitlessFlashBot Backup Script

PROJECT_DIR="$PROJECT_DIR"
BACKUP_DIR="/opt/backups/flashbot"
DATE=\$(date +%Y%m%d_%H%M%S)

mkdir -p \$BACKUP_DIR

# Backup configuration and data
tar -czf \$BACKUP_DIR/flashbot_backup_\$DATE.tar.gz \\
    \$PROJECT_DIR/.env \\
    \$PROJECT_DIR/executor/data \\
    \$PROJECT_DIR/executor/logs

# Keep only last 7 days of backups
find \$BACKUP_DIR -name "flashbot_backup_*.tar.gz" -mtime +7 -delete

echo "Backup completed: flashbot_backup_\$DATE.tar.gz"
EOF

chmod +x /usr/local/bin/flashbot-backup

# Setup daily backup cron job
(crontab -l 2>/dev/null; echo "0 2 * * * /usr/local/bin/flashbot-backup") | crontab -

# Final instructions
log_info "Deployment completed successfully! 🎉"
echo ""
echo "📋 Next Steps:"
echo "1. Edit $PROJECT_DIR/.env with your configuration"
echo "2. Replace 'your-domain.com' in /etc/nginx/sites-available/limitless-flash-bot"
echo "3. Setup SSL certificate: certbot --nginx -d your-domain.com"
echo "4. Start the bot: sudo -u $SERVICE_USER bash -c 'cd $PROJECT_DIR && pm2 restart limitless-flash-bot'"
echo ""
echo "📊 Useful Commands:"
echo "- Check status: sudo -u $SERVICE_USER pm2 status"
echo "- View logs: sudo -u $SERVICE_USER pm2 logs limitless-flash-bot"
echo "- Monitor: /usr/local/bin/flashbot-monitor"
echo "- Backup: /usr/local/bin/flashbot-backup"
echo ""
echo "🔗 Access Points:"
echo "- API: http://your-domain.com/health"
echo "- Logs: $PROJECT_DIR/executor/logs/"
echo "- Config: $PROJECT_DIR/.env"

log_info "VPS deployment script completed!"

