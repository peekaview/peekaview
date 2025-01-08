#!/bin/sh

# Replace server name with environment variable
export SERVER_NAME=${API_DOMAIN}:80
export TURN_SHARED_SECRET=${TURN_SHARED_SECRET}
export JWT_SECRET=${JWT_SECRET}

# Start FrankenPHP
exec frankenphp run --config /etc/caddy/Caddyfile 