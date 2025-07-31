#!/bin/bash

# Deployment script for webpush test environment
# This script will copy the files to /home/ubuntu/webpush_test and start the container

set -e

DEPLOY_DIR="/home/ubuntu/webpush_test"
CURRENT_DIR=$(pwd)

echo "🚀 Deploying webpush to $DEPLOY_DIR"

# Create deployment directory if it doesn't exist
sudo mkdir -p "$DEPLOY_DIR"

# Copy files to deployment directory
echo "📁 Copying files..."
sudo cp "$CURRENT_DIR/docker-compose.yml" "$DEPLOY_DIR/"
sudo cp "$CURRENT_DIR/nginx.conf" "$DEPLOY_DIR/"
sudo cp "$CURRENT_DIR/Dockerfile" "$DEPLOY_DIR/"
sudo cp "$CURRENT_DIR/index.html" "$DEPLOY_DIR/"
sudo cp "$CURRENT_DIR/favicon.svg" "$DEPLOY_DIR/"
sudo cp "$CURRENT_DIR/test.html" "$DEPLOY_DIR/"
sudo cp "$CURRENT_DIR/zuzzuu-sw.js" "$DEPLOY_DIR/"
sudo cp -r "$CURRENT_DIR/js" "$DEPLOY_DIR/"

# Set proper permissions
sudo chown -R $USER:$USER "$DEPLOY_DIR"

# Change to deployment directory
cd "$DEPLOY_DIR"

# Stop existing container if running
echo "🛑 Stopping existing container..."
docker-compose down 2>/dev/null || true

# Build and start the container
echo "🔨 Building and starting container..."
docker-compose up -d --build

# Wait a moment for container to start
sleep 5

# Check container status
echo "📊 Container status:"
docker-compose ps

# Test the endpoints
echo "🧪 Testing endpoints..."
echo "Testing HTTP (port 8080):"
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/health || echo "HTTP test failed"

echo -e "\nTesting HTTPS (port 8443):"
curl -s -o /dev/null -w "%{http_code}" -k https://localhost:8443/health || echo "HTTPS test failed"

echo -e "\n✅ Deployment complete!"
echo "🌐 Access your application at:"
echo "   HTTP:  http://localhost:8080"
echo "   HTTPS: https://localhost:8443"
echo "   API:   https://localhost:8443/api/"

echo -e "\n📋 Useful commands:"
echo "   View logs: docker-compose logs -f"
echo "   Stop:      docker-compose down"
echo "   Restart:   docker-compose restart"
