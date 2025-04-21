#!/bin/bash

# Deployment script for Flask application with Nginx, Gunicorn, systemd, and Certbot SSL
# Repository: https://github.com/sepehr071/livekitorg.git (beta branch)
# Domain: carema-caila-p1.ayand.cloud

# Exit immediately if a command exits with a non-zero status
set -e

# Set variables
DOMAIN="carema-caila-p1.ayand.cloud"
APP_NAME="caila-app"
APP_DIR="/var/www/${APP_NAME}"
REPO_URL="https://github.com/sepehr071/livekitorg.git"
REPO_BRANCH="beta"
USER=$(whoami)
EMAIL="sepehrr80@gmail.com"  # Change this to your email for Let's Encrypt

# Print current step with timestamp
log_step() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1"
}

# Check if script is run as root
if [ "$EUID" -ne 0 ]; then
    echo "Please run this script as root or with sudo."
    exit 1
fi

# 1. Update system and install dependencies
log_step "Updating system and installing dependencies"
apt update
apt upgrade -y
apt install -y python3 python3-pip python3-venv nginx ufw certbot python3-certbot-nginx git

# 2. Configure firewall
log_step "Configuring firewall"
ufw allow 'Nginx Full'
ufw allow ssh
ufw --force enable

# 3. Create application directory and set ownership
log_step "Creating application directory at $APP_DIR"
mkdir -p $APP_DIR
chown -R $USER:$USER $APP_DIR

# 4. Clone the repository
log_step "Cloning repository from $REPO_URL (branch: $REPO_BRANCH)"
cd /var/www
rm -rf ${APP_NAME}
git clone -b ${REPO_BRANCH} ${REPO_URL} ${APP_NAME}
cd ${APP_DIR}

# 5. Set up Python virtual environment
log_step "Setting up Python virtual environment"
python3 -m venv venv
source venv/bin/activate

# 6. Install Python dependencies
log_step "Installing Python dependencies"
pip install --upgrade pip
pip install -r requirements.txt
pip install gunicorn

# 7. Create the instance directory for database
log_step "Creating instance directory for database"
mkdir -p ${APP_DIR}/instance
chown -R $USER:$USER ${APP_DIR}/instance

# Note: .env file will be provided by the user

# 8. Configure systemd service for Gunicorn
log_step "Configuring systemd service for Gunicorn"
cat > /etc/systemd/system/${APP_NAME}.service << EOL
[Unit]
Description=Gunicorn instance to serve ${APP_NAME}
After=network.target

[Service]
User=${USER}
Group=www-data
WorkingDirectory=${APP_DIR}
Environment="PATH=${APP_DIR}/venv/bin"
ExecStart=${APP_DIR}/venv/bin/gunicorn --workers 3 --bind 127.0.0.1:8000 app:app
Restart=always

[Install]
WantedBy=multi-user.target
EOL

# 9. Start and enable systemd service
log_step "Starting and enabling systemd service"
systemctl start ${APP_NAME}
systemctl enable ${APP_NAME}
systemctl status ${APP_NAME}

# 10. Configure Nginx as reverse proxy
log_step "Configuring Nginx as reverse proxy"
cat > /etc/nginx/sites-available/${APP_NAME} << EOL
server {
    listen 80;
    server_name ${DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
    
    location /static {
        alias ${APP_DIR}/static;
        expires 30d;
    }
}
EOL

# 11. Enable Nginx site configuration
log_step "Enabling Nginx site configuration"
ln -sf /etc/nginx/sites-available/${APP_NAME} /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

# 12. Obtain SSL certificate with Certbot
log_step "Obtaining SSL certificate with Certbot"
certbot --nginx -d ${DOMAIN} --non-interactive --agree-tos --email ${EMAIL} --redirect

# 13. Set up auto-renewal test for SSL certificate
log_step "Setting up auto-renewal test for SSL certificate"
certbot renew --dry-run

# 14. Set proper permissions
log_step "Setting proper permissions"
chown -R ${USER}:www-data ${APP_DIR}
chmod -R 750 ${APP_DIR}

log_step "Application has been deployed successfully at https://${DOMAIN}"
log_step "You can check the status of the application with: systemctl status ${APP_NAME}"
log_step "View logs with: journalctl -u ${APP_NAME}"

echo ""
echo "==================================================================="
echo "Deployment completed successfully!"
echo "Your application is now running at: https://${DOMAIN}"
echo "==================================================================="
echo ""
echo "IMPORTANT: Remember to add your .env file to ${APP_DIR}/.env"
echo ""
echo "Useful commands:"
echo "- Check service status: sudo systemctl status ${APP_NAME}"
echo "- View logs: sudo journalctl -u ${APP_NAME} -f"
echo "- Restart application: sudo systemctl restart ${APP_NAME}"
echo "- Reload Nginx: sudo systemctl reload nginx"
echo "- View Nginx logs: sudo tail -f /var/log/nginx/access.log"
echo "- View Nginx error logs: sudo tail -f /var/log/nginx/error.log"