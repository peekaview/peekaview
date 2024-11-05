#!/bin/sh

# Replace domain placeholders with environment variables
sed -i "s|REPLACE_TURN_DOMAIN|$TURN_DOMAIN|g" /etc/caddy.yaml
sed -i "s|REPLACE_LIVEKIT_DOMAIN|$LIVEKIT_DOMAIN|g" /etc/caddy.yaml
sed -i "s|REPLACE_API_DOMAIN|$API_DOMAIN|g" /etc/caddy.yaml
sed -i "s|REPLACE_APP_DOMAIN|$APP_DOMAIN|g" /etc/caddy.yaml
sed -i "s|REPLACE_CONTROL_DOMAIN|$CONTROL_DOMAIN|g" /etc/caddy.yaml

# Run Caddy with yaml config
exec caddy run --config /etc/caddy.yaml --adapter yaml