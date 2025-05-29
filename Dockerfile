# Production stage with Nginx
FROM nginx:alpine

# Copy built files from build stage (Vite outputs to 'dist')
COPY --from=build /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Create directory for SSL certificates
RUN mkdir -p /etc/nginx/certs

# Expose ports
EXPOSE 8080
EXPOSE 8443

# Start Nginx server
CMD ["nginx", "-g", "daemon off;"]