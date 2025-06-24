# WordPress + SQLite Docker Container

This project provides a Docker setup for running WordPress with SQLite instead of MySQL, based on the approach from [soulteary/docker-sqlite-wordpress](https://github.com/soulteary/docker-sqlite-wordpress).

## Features

- WordPress with SQLite database (no MySQL required)
- Based on official WordPress Docker image
- Uses the official [SQLite Database Integration](https://wordpress.org/plugins/sqlite-database-integration/) plugin
- Lightweight and portable - entire database stored in a single file
- Perfect for development, testing, or small production sites

## Quick Start

### Using Docker Compose (Recommended)

1. Clone this repository:
```bash
git clone <your-repo-url>
cd <your-repo-name>
```

2. Start the container:
```bash
docker compose up -d
```

3. Access WordPress at http://localhost:8080 and complete the installation wizard.

### Using Docker CLI

```bash
# Build the image
docker build -t wordpress-sqlite .

# Run the container
docker run -d -p 8080:80 -v $(pwd)/wp-content:/var/www/html/wp-content wordpress-sqlite
```

## Configuration

### Database Location

By default, the SQLite database is stored at `/var/www/html/wp-content/database/.ht.sqlite`. This location is persisted via the volume mount.

### Ports

The container exposes port 80 internally, which is mapped to port 8080 on your host by default. You can change this in the `docker-compose.yml` file.

### Volumes

- `wordpress_data`: Stores the WordPress core files
- `./wp-content`: Mounted to persist your themes, plugins, uploads, and SQLite database

## Production Considerations

While SQLite works well for many use cases, consider the following:

- SQLite is best suited for sites with moderate traffic
- For high-traffic sites or sites requiring advanced database features, MySQL/MariaDB may be more appropriate
- Always backup your database file regularly

## Credits

This implementation is based on:
- [soulteary/docker-sqlite-wordpress](https://github.com/soulteary/docker-sqlite-wordpress)
- [WordPress SQLite Database Integration Plugin](https://wordpress.org/plugins/sqlite-database-integration/)

## License

This project follows the same licensing as WordPress (GPL v2 or later).
