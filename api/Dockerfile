FROM dunglas/frankenphp:latest

# Set working directory in container
WORKDIR /app
# Copy PHP file into container
COPY ./api.php /app/public/index.php
COPY ./download.php /app/public/download.php
COPY ./send.php /app/public/send.php
COPY ./helper /app/public/helper
COPY ./composer.json /app/public/composer.json

# Install Git
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Install Composer
RUN curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer

# Set working directory to public for composer install
WORKDIR /app/public
RUN composer install --no-dev --no-interaction --optimize-autoloader

# Reset working directory
WORKDIR /app

# Copy and set up entrypoint script
COPY ./docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]

