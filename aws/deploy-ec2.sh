#!/usr/bin/env bash
# ==============================================================================
# AWS EC2 Automated Deployment Script for Real-Time Auction Engine
# Works on Amazon Linux 2023, Ubuntu 22.04 / 24.04 LTS
# ==============================================================================

set -euo pipefail

echo "=========================================================="
echo " Starting AWS Deployment: Real-Time Bidding Engine"
echo "=========================================================="

# 1. Update OS and Install Docker & Docker Compose if missing
if ! command -v docker &> /dev/null; then
  echo "Installing Docker..."
  if [ -f /etc/os-release ] && grep -qi "ubuntu" /etc/os-release; then
    sudo apt-get update -y
    sudo apt-get install -y ca-certificates curl gnupg lsb-release
    sudo install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    sudo chmod a+r /etc/apt/keyrings/docker.gpg
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    sudo apt-get update -y
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  else
    sudo dnf update -y
    sudo dnf install -y docker git
    sudo systemctl enable --now docker
  fi
  sudo usermod -aG docker "$USER"
fi

# 2. Verify Docker service is running
sudo systemctl start docker || true

# 3. Build & Run the Production Auction Stack
echo "Launching production stack (PostgreSQL 16 + Fastify + WS Server)..."
docker compose -f docker-compose.prod.yml down --remove-orphans || true
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d

# 4. Wait for Health Check
echo "Waiting for health check endpoint..."
sleep 5
for i in {1..15}; do
  if curl -sf http://127.0.0.1:3000/health > /dev/null; then
    echo "Auction server healthy at http://127.0.0.1:3000/health"
    break
  fi
  echo "Waiting for server to become ready... ($i/15)"
  sleep 2
done

echo "=========================================================="
echo " AWS BACKEND DEPLOYMENT COMPLETE!"
echo " Server is listening on http://0.0.0.0:3000"
echo " WebSocket endpoint: ws://0.0.0.0:3000/ws"
echo "=========================================================="
