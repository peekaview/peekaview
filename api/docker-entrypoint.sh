#!/bin/sh

# Replace server name with environment variable
export SERVER_NAME=${API_DOMAIN}:80

# Start FrankenPHP
exec frankenphp run --config /etc/caddy/Caddyfile 