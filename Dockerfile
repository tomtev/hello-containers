# syntax=docker/dockerfile:1

FROM php:8.2-apache

# Install required extensions and tools
RUN apt-get update && \
    apt-get install -y \
        libsqlite3-dev \
        unzip \
        curl && \
    docker-php-ext-install pdo_sqlite && \
    a2enmod rewrite && \
    rm -rf /var/lib/apt/lists/*

# Download and extract WordPress
RUN curl -o wordpress.tar.gz -fL "https://wordpress.org/latest.tar.gz" && \
    tar -xzf wordpress.tar.gz -C /var/www/ && \
    rm wordpress.tar.gz && \
    mv /var/www/wordpress/* /var/www/html/ && \
    rmdir /var/www/wordpress

# Download and install SQLite Database Integration plugin
RUN curl -L https://downloads.wordpress.org/plugin/sqlite-database-integration.2.2.2.zip -o sqlite-plugin.zip && \
    unzip sqlite-plugin.zip -d /var/www/html/wp-content/plugins/ && \
    rm sqlite-plugin.zip

# Copy the db.php drop-in file
RUN cp /var/www/html/wp-content/plugins/sqlite-database-integration/db.copy \
       /var/www/html/wp-content/db.php

# Create necessary directories
RUN mkdir -p /var/www/html/wp-content/database && \
    mkdir -p /var/www/html/wp-content/uploads

# Set permissions
RUN chown -R www-data:www-data /var/www/html

# Configure Apache to listen on port 8080
RUN sed -i 's/80/8080/g' /etc/apache2/sites-available/000-default.conf /etc/apache2/ports.conf

# Create a basic wp-config.php that works with reverse proxy
RUN echo "<?php \
define('DB_NAME', 'wordpress'); \
define('DB_USER', 'root'); \
define('DB_PASSWORD', ''); \
define('DB_HOST', 'localhost'); \
define('DB_CHARSET', 'utf8'); \
define('DB_COLLATE', ''); \
define('AUTH_KEY',         'put-your-unique-phrase-here'); \
define('SECURE_AUTH_KEY',  'put-your-unique-phrase-here'); \
define('LOGGED_IN_KEY',    'put-your-unique-phrase-here'); \
define('NONCE_KEY',        'put-your-unique-phrase-here'); \
define('AUTH_SALT',        'put-your-unique-phrase-here'); \
define('SECURE_AUTH_SALT', 'put-your-unique-phrase-here'); \
define('LOGGED_IN_SALT',   'put-your-unique-phrase-here'); \
define('NONCE_SALT',       'put-your-unique-phrase-here'); \
\$table_prefix = 'wp_'; \
define('WP_DEBUG', false); \
/* Handle reverse proxy */ \
if (!empty(\$_SERVER['HTTP_X_FORWARDED_HOST'])) { \
    \$_SERVER['HTTP_HOST'] = \$_SERVER['HTTP_X_FORWARDED_HOST']; \
} \
if (!empty(\$_SERVER['HTTP_X_FORWARDED_PROTO']) && \$_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https') { \
    \$_SERVER['HTTPS'] = 'on'; \
} \
/* Allow WordPress to detect the correct URL */ \
if (isset(\$_SERVER['HTTP_HOST'])) { \
    define('WP_HOME', 'http://' . \$_SERVER['HTTP_HOST']); \
    define('WP_SITEURL', 'http://' . \$_SERVER['HTTP_HOST']); \
} \
if ( ! defined( 'ABSPATH' ) ) { \
    define( 'ABSPATH', __DIR__ . '/' ); \
} \
require_once ABSPATH . 'wp-settings.php';" > /var/www/html/wp-config.php

# Enable Apache AllowOverride for .htaccess
RUN echo "<Directory /var/www/html> \n\
    Options Indexes FollowSymLinks \n\
    AllowOverride All \n\
    Require all granted \n\
</Directory>" > /etc/apache2/conf-available/wordpress.conf && \
    a2enconf wordpress

EXPOSE 8080

# Run Apache in foreground
CMD ["apache2-foreground"]