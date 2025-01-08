FROM dunglas/frankenphp:latest

# Set working directory in container
WORKDIR /app
# Copy PHP file into container
COPY ./api.php /app/public/index.php
COPY ./helper /app/public/helper

# Copy and set up entrypoint script
COPY ./docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]

