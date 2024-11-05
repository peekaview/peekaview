#!/bin/bash

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


# Start Docker Compose build
echo "Building Docker Compose..."
docker-compose build --no-cache

echo "Setup complete!" 
echo "Run 'docker-compose up -d' to start the services"