#!/bin/bash

# Check if system is Debian-based and 64-bit
if ! command -v apt &> /dev/null || ! uname -m | grep -q "x86_64"; then
    echo "Sorry, this script is only supported on Debian-based 64-bit systems (Ubuntu, Debian, Linux Mint)."
    exit 1
fi

echo "Checking requirements..."
echo "--------------------------------"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker needs to be installed: sudo apt install docker.io"
else
    echo "✅ Docker is installed"
fi

# Check if Docker service is running
if ! systemctl is-active --quiet docker; then
    echo "❌ Docker service needs to be started: sudo systemctl start docker"
else
    echo "✅ Docker service is running"
fi

# Check if user is in docker group
if ! groups $USER | grep -q "docker"; then
    echo "❌ User needs to be added to docker group: sudo usermod -aG docker $USER"
    echo "  Note: You'll need to log out and back in for this to take effect"
else
    echo "✅ User is in docker group"
fi

# Check Docker Compose
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose needs to be installed: sudo apt install docker-compose"
else
    echo "✅ Docker Compose is installed"
fi

# Check if Docker can run without sudo
if ! docker ps &> /dev/null; then
    echo "❌ Docker requires sudo or proper permissions"
else
    echo "✅ Docker can run without sudo"
fi

# Check wine64
if ! dpkg -l wine64 2>/dev/null | grep -q "^ii"; then
    echo "❌ wine64 needs to be installed: sudo apt install wine64"
else
    echo "✅ wine64 is installed"
fi

# Check wine32
if ! dpkg -l wine32:i386 2>/dev/null | grep -q "^ii"; then
    echo "❌ wine32 needs to be installed: sudo apt-get install wine32:i386"
else
    echo "✅ wine32 is installed"
fi

# Check wine symlink
if [ ! -L "/usr/bin/wine64" ] && [ -f "/usr/bin/wine" ]; then
    echo "❌ wine symlink needs to be created: sudo ln -s /usr/bin/wine /usr/bin/wine64"
else
    echo "✅ wine symlink exists"
fi

# Check mono-devel
if ! dpkg -l | grep -q "^ii  mono-devel "; then
    echo "❌ mono-devel needs to be installed: sudo apt install mono-devel"
else
    echo "✅ mono-devel is installed"
fi

# Check .wine backup
if [ -d "$HOME/.wine" ] && [ ! -d "$HOME/.wine.old" ]; then
    echo "Optional: if you experience a could not load kernel32.dll error"
    echo "ℹ️ Backup .wine directory with: mv ~/.wine/ ~/.wine.old"
fi

# Check certutil
if ! command -v certutil &> /dev/null; then
    echo "❌ certutil needs to be installed: sudo apt install libnss3-tools"
else
    echo "✅ certutil is installed"
fi

# Check mkcert
if [ ! -f "mkcert" ]; then
    echo "❌ mkcert needs to be installed: downloading mkcert..."
    wget -O mkcert https://github.com/FiloSottile/mkcert/releases/download/v1.4.4/mkcert-v1.4.4-linux-amd64
    chmod +x mkcert
else
    echo "✅ mkcert is installed"
fi

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

