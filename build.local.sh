#!/bin/bash

# Check if system is Debian-based and 64-bit
if ! command -v apt &> /dev/null || ! uname -m | grep -q "x86_64"; then
    echo "Sorry, this script is only supported on Debian-based 64-bit systems (Ubuntu, Debian, Linux Mint)."
    exit 1
fi

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "Docker is not installed. Please install it first."
    exit 1
fi

# Array of domains to check/add
source .env
DOMAINS=(
    "${API_DOMAIN}"
    "${APP_DOMAIN}"
    "${ADMIN_DOMAIN}"
    "${TURN_DOMAIN}"
    "${LIVEKIT_DOMAIN}"
    "${CONTROL_DOMAIN}"
)

# Function to backup /etc/hosts
backup_hosts_file() {
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_file="/tmp/hosts.backup_${timestamp}"
    echo "Creating backup of /etc/hosts at ${backup_file}"
    cp /etc/hosts "${backup_file}"
}

# Function to add domain to /etc/hosts if not exists
add_domain_to_hosts() {
    local domain=$1
    if ! grep -q "^127.0.0.1[[:space:]]*$domain" /etc/hosts; then
        echo "Adding $domain to /etc/hosts"
        echo "127.0.0.1 $domain" | sudo tee -a /etc/hosts > /dev/null
    else
        echo "$domain already exists in /etc/hosts"
    fi
}

# Backup hosts file before making any changes
backup_hosts_file

# Add each domain to /etc/hosts
echo "Checking and adding domains to /etc/hosts..."
for domain in "${DOMAINS[@]}"; do
    add_domain_to_hosts "$domain"
done

# Check if mkcert is installed
echo "Checking if mkcert is installed..."
if [ ! -f "mkcert" ]; then
    wget -O mkcert https://github.com/FiloSottile/mkcert/releases/download/v1.4.4/mkcert-v1.4.4-linux-amd64
    chmod +x  mkcert
fi

# Check if certutil is installed
echo "Checking if certutil is installed..."
if ! command -v certutil &> /dev/null; then
    echo "certutil is not installed. Please install it using:"
    echo "sudo apt-get install libnss3-tools"
    exit 1
fi

# Generate local development certificates
echo "Generating local development certificates..."
./mkcert --cert-file ingress/certs/peekaview.crt --key-file ingress/certs/peekaview.key peekaview 127.0.0.1 ::1 peekaview.local "*.peekaview.local"
./mkcert -install

# Start Docker Compose build
echo "Building Docker Compose..."
docker-compose build --no-cache

# Print setup complete message
echo "================================================"
echo "Setup complete!" 
echo "Run 'docker-compose up -d' to start the services"
echo "Afterwards you can than access the app at https://${APP_DOMAIN}"
echo "Chrome needs a restart to trust the local development certificates"
echo "================================================"

