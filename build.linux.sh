#!/bin/bash

# Check if system is Debian-based and 64-bit
if ! command -v apt &> /dev/null || ! uname -m | grep -q "x86_64"; then
    echo "Sorry, this script is only supported on Debian-based 64-bit systems (Ubuntu, Debian, Linux Mint)."
    exit 1
fi

echo "Checking requirements..."
echo "--------------------------------"

MISSING=()
ADDITIONAL_STEPS=()

# Check all requirements
command -v docker >/dev/null || MISSING+=("docker.io")
command -v docker-compose >/dev/null || MISSING+=("docker-compose")
dpkg -l wine64 2>/dev/null | grep -q "^ii" || MISSING+=("wine64")
dpkg -l wine32:i386 2>/dev/null | grep -q "^ii" || MISSING+=("wine32:i386")
dpkg -l | grep -q "^ii  mono-devel " || MISSING+=("mono-devel")
dpkg -l | grep -q "^ii  rpm " || MISSING+=("rpm")
command -v certutil >/dev/null || MISSING+=("libnss3-tools")
command -v gcc >/dev/null || MISSING+=("build-essential")
command -v python3 >/dev/null || MISSING+=("python3")
npm install -g pnpm

# Check wine symlink
if [ ! -L "/usr/bin/wine64" ] && [ -f "/usr/bin/wine" ]; then
    ADDITIONAL_STEPS+=("sudo ln -s /usr/bin/wine /usr/bin/wine64")
fi

# Check .wine backup
if [ -d "$HOME/.wine" ] && [ ! -d "$HOME/.wine.old" ]; then
    ADDITIONAL_STEPS+=("mv ~/.wine/ ~/.wine.old")
fi

# Show summary
if [ ${#MISSING[@]} -ne 0 ]; then
    echo "Please install missing packages:"
    echo "sudo apt install ${MISSING[*]}"
fi

if [ ${#ADDITIONAL_STEPS[@]} -ne 0 ]; then
    echo -e "\nAdditional steps needed:"
    printf '%s\n' "${ADDITIONAL_STEPS[@]}"
fi


[ ${#MISSING[@]} -eq 0 ] && [ ${#ADDITIONAL_STEPS[@]} -eq 0 ] && echo "✅ All requirements met!"

# Ask for confirmation before proceeding
read -p "Press Enter to continue with certificate generation and Docker build, or Ctrl+C to cancel..."


echo "--------------------------------"

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

# Generate local development certificates
echo "Generating local development certificates..."
./mkcert --cert-file ingress/certs/peekaview.crt --key-file ingress/certs/peekaview.key peekaview 127.0.0.1 ::1 peekaview.local "*.peekaview.local"
./mkcert -install

# Generate .env for app
echo "APP_URL=https://${APP_DOMAIN}" > app/.env
echo "API_URL=https://${API_DOMAIN}" >> app/.env
echo "CONNECT_SRC=${CONNECT_SRC}" >> app/.env

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

