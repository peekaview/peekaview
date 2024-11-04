FROM dunglas/frankenphp:latest

# Set working directory in container
WORKDIR /app

# Copy PHP file into container
COPY api.php /app/public/

# Create custom Caddyfile
RUN echo "{ \
    auto_https off \
    admin off \
    servers { \
    protocol http \
    } \
    } \
    \
    :80 { \
    root * /app/public \
    php_server \
    try_files {path} /api.php \
    }" > /etc/caddy/Caddyfile

# Set permissions
RUN chown -R www-data:www-data /app \
    && chmod -R 755 /app

# Start FrankenPHP in production mode
CMD ["frankenphp", "run", "--config", "/etc/caddy/Caddyfile"]
