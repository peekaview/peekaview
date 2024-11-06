# Use the livekit/caddyl4:latest image as the base
FROM livekit/caddyl4:latest

RUN apk add --no-cache nss-tools

# Copy the Caddyfile to the appropriate location
COPY ./caddy.template.yaml /etc/caddy.yaml
COPY ./certs /etc/caddy/certificates/custom

# Copy the entrypoint script and make it executable
COPY ./docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Change ENTRYPOINT to use direct execution instead of /bin/sh -c
ENTRYPOINT ["/docker-entrypoint.sh"]
