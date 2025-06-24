# syntax=docker/dockerfile:1

FROM wordpress:latest

# Install SQLite3 and required PHP extensions
RUN apt-get update && \
    apt-get install -y sqlite3 libsqlite3-dev unzip && \
    docker-php-ext-install pdo_sqlite && \
    rm -rf /var/lib/apt/lists/*

# Download and install the SQLite Database Integration plugin
RUN curl -L https://downloads.wordpress.org/plugin/sqlite-database-integration.2.2.2.zip -o sqlite-plugin.zip && \
    unzip sqlite-plugin.zip -d /usr/src/wordpress/wp-content/plugins/ && \
    rm sqlite-plugin.zip

# Copy the db.php drop-in file to enable SQLite
RUN cp /usr/src/wordpress/wp-content/plugins/sqlite-database-integration/db.copy \
       /usr/src/wordpress/wp-content/db.php

# Create the database directory
RUN mkdir -p /usr/src/wordpress/wp-content/database && \
    chown -R www-data:www-data /usr/src/wordpress/wp-content/database

# Set proper permissions
RUN chown -R www-data:www-data /usr/src/wordpress/wp-content

# Expose port 80 for the web server
EXPOSE 80

# Use the default WordPress entrypoint and CMD
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["apache2-foreground"]