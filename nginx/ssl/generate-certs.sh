#!/bin/bash

# Generate private key
openssl genrsa -out nginx.key 2048

# Generate certificate signing request
openssl req -new -key nginx.key -out nginx.csr -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"

# Generate self-signed certificate
openssl x509 -req -days 365 -in nginx.csr -signkey nginx.key -out nginx.crt

# Clean up CSR file
rm nginx.csr

echo "SSL certificates generated successfully!"
