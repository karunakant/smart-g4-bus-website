#!/bin/bash
# ==============================================================================
# SmartBus G4 & Z-Audio Home Automation - ZAudio RSIP Gateway Deployment Script
# Supports both Docker Container Deployment and Systemd Native Installation
# ==============================================================================

MODE=${1:-"docker"}

echo "======================================================="
echo " Installing SmartBus G4 & Z-Audio Server (ZAudio RSIP Target)"
echo " Mode: $MODE"
echo "======================================================="

if [ "$MODE" = "docker" ]; then
    echo "[+] Checking for Docker..."
    if ! command -v docker &> /dev/null; then
        echo "[+] Installing Docker on system..."
        curl -fsSL https://get.docker.com | sh
        sudo usermod -aG docker $USER
    fi

    echo "[+] Building and starting Docker container..."
    if command -v docker-compose &> /dev/null; then
        sudo docker-compose up -d --build
    else
        sudo docker compose up -d --build
    fi

    echo "======================================================="
    echo " Docker Container Started Successfully!"
    echo " Web Application URL: http://$(hostname -I | awk '{print $1}'):3000"
    echo " Gateway Target IP  : 192.168.0.200"
    echo " SmartBus UDP Port  : 6000"
    echo " Logs Command       : sudo docker logs -f smartbusg4-home-automation"
    echo "======================================================="
    exit 0
fi

# Native Systemd Installation Fallback
sudo apt-get update -y
if ! command -v node &> /dev/null; then
    echo "[+] Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

echo "[+] Installing NPM packages..."
npm install --production

echo "[+] Granting port 80 binding capability for Amazon Echo discovery..."
sudo setcap 'cap_net_bind_service=+ep' $(which node) || true

echo "[+] Setting up systemd background service..."
sudo cp systemd/smartbusg4.service /etc/systemd/system/smartbusg4.service
sudo systemctl daemon-reload
sudo systemctl enable smartbusg4
sudo systemctl restart smartbusg4

echo "======================================================="
echo " Native Installation Complete!"
echo " Web Application URL: http://$(hostname -I | awk '{print $1}'):3000"
echo " Gateway Target IP  : 192.168.0.200"
echo " SmartBus UDP Port  : 6000"
echo " Service Status     : sudo systemctl status smartbusg4"
echo "======================================================="
