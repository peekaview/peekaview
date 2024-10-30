FROM dunglas/frankenphp:latest

# Set working directory in container
WORKDIR /app

# Copy PHP file into container
COPY resources/api.php /app/public/

# Set permissions
RUN chown -R www-data:www-data /app \
    && chmod -R 755 /app

# Expose ports 80
EXPOSE 80

# Start FrankenPHP in production mode
CMD ["frankenphp", "run", "--config", "/etc/caddy/Caddyfile"]
