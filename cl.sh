#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

echo "🚀 Starting single-node K3s cluster installation..."

# Step 1: Export variables explicitly to prevent sh pipe syntax errors
echo "📦 Installing K3s..."
export K3S_KUBECONFIG_MODE="644"
curl -sfL https://get.k3s.io | sh -s -

# Step 2: Wait for the K3s service to fully start up
echo "⏳ Waiting for K3s service to initialize..."
sleep 15

# Step 3: Configure native kubectl for the current user
echo "⚙️ Configuring kubectl configuration for $(whoami)..."
mkdir -p "$HOME/.kube"
sudo cp /etc/rancher/k3s/k3s.yaml "$HOME/.kube/config"
sudo chown "$(id -u):$(id -g)" "$HOME/.kube/config"

# Set environment variable for the current session
export KUBECONFIG="$HOME/.kube/config"

# Step 4: Verify the installation
echo "✅ Verification: Fetching cluster nodes..."
kubectl get nodes

echo "🎉 K3s cluster is ready! You can now use standard 'kubectl' commands."
