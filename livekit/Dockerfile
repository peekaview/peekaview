# Use the livekit/livekit-server:latest image as the base
FROM livekit/livekit-server:latest

# Copy the livekit.yaml to the appropriate location
COPY ./livekit.template.yaml /etc/livekit.yaml

# Copy and set up entrypoint script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
