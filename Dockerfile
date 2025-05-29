FROM nginx:alpine

# Copy static files to nginx html directory
COPY . /usr/share/nginx/html/

# Copy custom nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Create startup script
RUN echo '#!/bin/sh' > /docker-entrypoint-custom.sh && \
    echo 'if [ ! -f /etc/nginx/certs/fullchain.pem ]; then' >> /docker-entrypoint-custom.sh && \
    echo '  echo "SSL certificates not found, starting with HTTP fallback on port 8080"' >> /docker-entrypoint-custom.sh && \
    echo '  sed -i "s/listen 8443 ssl;/listen 8080;/" /etc/nginx/nginx.conf' >> /docker-entrypoint-custom.sh && \
    echo '  sed -i "s/http2 on;//" /etc/nginx/nginx.conf' >> /docker-entrypoint-custom.sh && \
    echo '  sed -i "/ssl_/d" /etc/nginx/nginx.conf' >> /docker-entrypoint-custom.sh && \
    echo 'fi' >> /docker-entrypoint-custom.sh && \
    echo 'exec "$@"' >> /docker-entrypoint-custom.sh && \
    chmod +x /docker-entrypoint-custom.sh

# Expose both ports
EXPOSE 8443 8080

ENTRYPOINT ["/docker-entrypoint-custom.sh"]
CMD ["nginx", "-g", "daemon off;"]
