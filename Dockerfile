# Production stage with Nginx
FROM nginx:alpine

# Copy static files to nginx html directory
COPY . /usr/share/nginx/html/

# Copy nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Create directory for SSL certificates
RUN mkdir -p /etc/nginx/certs

# Create startup script to handle missing SSL certificates
RUN echo '#!/bin/sh' > /docker-entrypoint-custom.sh && \
    echo 'if [ ! -f /etc/nginx/certs/fullchain.pem ]; then' >> /docker-entrypoint-custom.sh && \
    echo '  echo "SSL certificates not found, removing SSL configuration"' >> /docker-entrypoint-custom.sh && \
    echo '  sed -i "/listen 8443 ssl;/d" /etc/nginx/nginx.conf' >> /docker-entrypoint-custom.sh && \
    echo '  sed -i "/http2 on;/d" /etc/nginx/nginx.conf' >> /docker-entrypoint-custom.sh && \
    echo '  sed -i "/ssl_/d" /etc/nginx/nginx.conf' >> /docker-entrypoint-custom.sh && \
    echo '  sed -i "/Strict-Transport-Security/d" /etc/nginx/nginx.conf' >> /docker-entrypoint-custom.sh && \
    echo 'fi' >> /docker-entrypoint-custom.sh && \
    echo 'exec "$@"' >> /docker-entrypoint-custom.sh && \
    chmod +x /docker-entrypoint-custom.sh

# Expose ports
EXPOSE 8080 8443

ENTRYPOINT ["/docker-entrypoint-custom.sh"]
CMD ["nginx", "-g", "daemon off;"]