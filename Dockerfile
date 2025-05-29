FROM nginx:alpine

# Copy static files to nginx html directory
COPY . /usr/share/nginx/html/

# Copy custom nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Expose port 8443
EXPOSE 8443
