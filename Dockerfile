# Dockerfile for SmartBus G4, Z-Audio & Alexa Smart Home Automation System
FROM node:20-alpine

# Install Python3 for SQLite conversion scripts
RUN apk add --no-cache python3 && \
    ln -sf /usr/bin/python3 /usr/bin/python

# Set working directory
WORKDIR /app

# Copy package descriptors
COPY package*.json ./

# Install production dependencies
RUN npm install --omit=dev

# Copy application source code
COPY . .

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV UDP_PORT=6000
ENV GATEWAY_IP=192.168.0.200
ENV ZAUDIO_IP=192.168.0.200

# Expose HTTP/WebSocket port (3000), Alexa Port (80), SmartBus UDP port (6000), and Alexa SSDP port (1900)
EXPOSE 3000
EXPOSE 80
EXPOSE 6000/udp
EXPOSE 1900/udp

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/status || exit 1

# Start server
CMD ["node", "server.js"]
