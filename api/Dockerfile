FROM dunglas/frankenphp:latest

# Set working directory in container
WORKDIR /app

# Copy PHP file into container
COPY api.php /app/public/index.php

ENV SERVER_NAME=:80
# Start FrankenPHP in production mode
CMD ["frankenphp", "run", "--config", "/etc/caddy/Caddyfile"]
