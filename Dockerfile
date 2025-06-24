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

# Optimize Apache for container environment
RUN echo "ServerName localhost" >> /etc/apache2/apache2.conf && \
    echo "HostnameLookups Off" >> /etc/apache2/apache2.conf && \
    echo "KeepAlive Off" >> /etc/apache2/apache2.conf && \
    a2dismod -f status

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
    mkdir -p /var/www/html/wp-content/uploads && \
    mkdir -p /var/www/html/wp-content/mu-plugins

# Set permissions
RUN chown -R www-data:www-data /var/www/html

# Configure Apache to listen on port 8080
RUN sed -i 's/80/8080/g' /etc/apache2/sites-available/000-default.conf /etc/apache2/ports.conf

# Create a basic wp-config.php that works with reverse proxy and sets URLs dynamically
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
/* Performance optimizations for container environment */ \
define('COMPRESS_CSS', true); \
define('COMPRESS_SCRIPTS', true); \
define('CONCATENATE_SCRIPTS', true); \
define('ENFORCE_GZIP', true); \
/* Handle reverse proxy */ \
if (!empty(\$_SERVER['HTTP_X_FORWARDED_HOST'])) { \
    \$_SERVER['HTTP_HOST'] = \$_SERVER['HTTP_X_FORWARDED_HOST']; \
} \
if (!empty(\$_SERVER['HTTP_X_FORWARDED_PROTO']) && \$_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https') { \
    \$_SERVER['HTTPS'] = 'on'; \
} \
/* Dynamic URL configuration based on X-Forwarded headers */ \
if (!empty(\$_SERVER['HTTP_X_FORWARDED_PREFIX'])) { \
    \$protocol = (!empty(\$_SERVER['HTTPS']) && \$_SERVER['HTTPS'] !== 'off') ? 'https' : 'http'; \
    \$host = \$_SERVER['HTTP_HOST']; \
    \$prefix = \$_SERVER['HTTP_X_FORWARDED_PREFIX']; \
    define('WP_HOME', \$protocol . '://' . \$host . \$prefix); \
    define('WP_SITEURL', \$protocol . '://' . \$host . \$prefix); \
    /* Force WordPress to use our URLs */ \
    \$_SERVER['REQUEST_URI'] = \$prefix . \$_SERVER['REQUEST_URI']; \
} \
if ( ! defined( 'ABSPATH' ) ) { \
    define( 'ABSPATH', __DIR__ . '/' ); \
} \
require_once ABSPATH . 'wp-settings.php';" > /var/www/html/wp-config.php

# Create a mu-plugin to automatically set pretty permalinks and fix URLs after installation
RUN echo "<?php \
/* \
Plugin Name: Auto Configure WordPress \
Description: Automatically configures WordPress settings for container deployment \
*/ \
\
// Hook into WordPress after installation \
add_action('init', function() { \
    // Only run if permalinks haven't been set yet \
    \$permalink_structure = get_option('permalink_structure'); \
    if (empty(\$permalink_structure)) { \
        // Set pretty permalinks \
        update_option('permalink_structure', '/%postname%/'); \
        flush_rewrite_rules(); \
    } \
    \
    // Update site URL if needed based on X-Forwarded headers \
    if (!empty(\$_SERVER['HTTP_X_FORWARDED_PREFIX'])) { \
        \$protocol = (!empty(\$_SERVER['HTTPS']) && \$_SERVER['HTTPS'] !== 'off') ? 'https' : 'http'; \
        \$host = \$_SERVER['HTTP_HOST']; \
        \$prefix = \$_SERVER['HTTP_X_FORWARDED_PREFIX']; \
        \$expected_url = \$protocol . '://' . \$host . \$prefix; \
        \
        \$home = get_option('home'); \
        \$siteurl = get_option('siteurl'); \
        \
        if (\$home !== \$expected_url) { \
            update_option('home', \$expected_url); \
        } \
        if (\$siteurl !== \$expected_url) { \
            update_option('siteurl', \$expected_url); \
        } \
    } \
}); \
\
// Fix URLs in content \
add_filter('the_content', function(\$content) { \
    if (!empty(\$_SERVER['HTTP_X_FORWARDED_PREFIX'])) { \
        \$prefix = \$_SERVER['HTTP_X_FORWARDED_PREFIX']; \
        \$content = str_replace('href=\"/', 'href=\"' . \$prefix . '/', \$content); \
        \$content = str_replace('src=\"/', 'src=\"' . \$prefix . '/', \$content); \
    } \
    return \$content; \
}); \
\
// Fix admin URLs \
add_filter('admin_url', function(\$url) { \
    if (!empty(\$_SERVER['HTTP_X_FORWARDED_PREFIX']) && strpos(\$url, \$_SERVER['HTTP_X_FORWARDED_PREFIX']) === false) { \
        \$prefix = \$_SERVER['HTTP_X_FORWARDED_PREFIX']; \
        \$url = str_replace('/wp-admin', \$prefix . '/wp-admin', \$url); \
    } \
    return \$url; \
});" > /var/www/html/wp-content/mu-plugins/auto-configure.php

# Create .htaccess file for pretty permalinks
RUN echo "<IfModule mod_rewrite.c> \n\
RewriteEngine On \n\
RewriteBase / \n\
RewriteRule ^index\\.php$ - [L] \n\
RewriteCond %{REQUEST_FILENAME} !-f \n\
RewriteCond %{REQUEST_FILENAME} !-d \n\
RewriteRule . /index.php [L] \n\
</IfModule>" > /var/www/html/.htaccess && \
    chown www-data:www-data /var/www/html/.htaccess

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