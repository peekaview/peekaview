#!/bin/sh

sed -i "s|REPLACE_API_KEY|$LIVEKIT_API_KEY|g" /etc/livekit.yaml
sed -i "s|REPLACE_API_SECRET|$LIVEKIT_API_SECRET|g" /etc/livekit.yaml
sed -i "s|REPLACE_TURN_DOMAIN|$LIVEKIT_TURN_DOMAIN|g" /etc/livekit.yaml
sed -i "s|REPLACE_LIVEKIT_DOMAIN|$LIVEKIT_DOMAIN|g" /etc/livekit.yaml

/livekit-server --config /etc/livekit.yaml 