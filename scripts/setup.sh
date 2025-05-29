#!/bin/bash

# Create necessary directories
mkdir -p nginx/ssl logs/nginx

# Generate SSL certificates if they don't exist
if [ ! -f "nginx/ssl/nginx.crt" ]; then
    echo "Generating SSL certificates..."
    cd nginx/ssl
    chmod +x generate-certs.sh
    ./generate-certs.sh
    cd ../..
fi

# Build and start services
echo "Building and starting services..."
docker-compose up --build -d

echo "Services started successfully!"
echo "Application available at: https://localhost:8443"
echo "Check logs with: docker-compose logs -f"
