#!/bin/sh

# Available services
AVAILABLE_INGRESS_SERVICES="LIVEKIT,TURN,API,APP,CONTROL"

# Set default value if INGRESS_SERVICES is not set
INGRESS_SERVICES=${INGRESS_SERVICES:-$AVAILABLE_INGRESS_SERVICES}
echo "Generating Caddy config for services: $INGRESS_SERVICES"

# Remove sections from caddy.yaml file that are not in INGRESS_SERVICES
for SERVICE in ${AVAILABLE_INGRESS_SERVICES//,/ }; do
    if ! echo "${INGRESS_SERVICES}" | grep -q "${SERVICE}"; then
        # Remove sections that are NOT in INGRESS_SERVICES
        sed -i "/### BEGIN ${SERVICE}/,/### END ${SERVICE}/d" /etc/caddy.yaml
        # Remove the actual domain from the certificates list that are NOT in INGRESS_SERVICES
        sed -i "/- REPLACE_${SERVICE}_DOMAIN/d" /etc/caddy.yaml
    else
        # replace the actual domain into the caddy.yaml file that is in INGRESS_SERVICES
        sed -i "s|REPLACE_${SERVICE}_DOMAIN|$(eval echo \$${SERVICE}_DOMAIN)|g" /etc/caddy.yaml
    fi
done

# Run Caddy with yaml config
exec caddy run --config /etc/caddy.yaml --adapter yaml