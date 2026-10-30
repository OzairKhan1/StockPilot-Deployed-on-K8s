
#!/bin/bash

set -e

# ==========================================
# Kubernetes Tools Installation Script
# It installs Helm, Prometheus Stack (It includes Prometheus, Grafana, AlertManger, NodeExporter and more) , Argocd, and Nginx-Controller
# ==========================================

echo "=========================================="
echo " Kubernetes Tools Installation"
echo "=========================================="

# ==========================================
# 1. Helm Installation
# ==========================================

install_helm() {

    if command -v helm &> /dev/null; then
        echo ""
        echo "Helm is already installed."
        helm version
        return 0
    fi

    echo ""
    echo "Helm is not installed."

    while true; do

        read -rp "Do you want to install Helm? (y/n/q): " choice

        case "$choice" in

            [Yy])
                echo "Installing Helm..."

                sudo apt-get update
                sudo apt-get install -y curl

                curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

                echo ""
                echo "Helm installation completed."
                helm version
                return 0
                ;;

            [Nn])
                echo "Helm is required for the remaining installations."
                echo "Exiting..."
                exit 0
                ;;

            [Qq])
                echo "Installation cancelled."
                exit 0
                ;;

            *)
                echo "Invalid choice. Enter y, n, or q."
                ;;

        esac

    done
}

install_helm

# ==========================================
# 2. Check kubectl
# ==========================================

if ! command -v kubectl &> /dev/null; then
    echo ""
    echo "ERROR: kubectl is not installed."
    echo "Please install kubectl before continuing."
    exit 1
fi

echo ""
echo "Helm and kubectl prerequisites verified."

# ==========================================
# 3. Function to Ask User
# ==========================================

ask_install() {

    local tool_name="$1"

    while true; do

        echo ""
        read -rp "Do you want to install $tool_name? (y/n/q): " choice

        case "$choice" in

            [Yy])
                return 0
                ;;

            [Nn])
                echo "Skipping $tool_name..."
                return 1
                ;;

            [Qq])
                echo "Installation cancelled by user."
                exit 0
                ;;

            *)
                echo "Invalid choice. Enter y, n, or q."
                ;;

        esac

    done
}

# ==========================================
# 4. Prometheus Stack Installation
# ==========================================

if ask_install "Prometheus Stack"; then

    echo ""
    echo "Installing Prometheus Stack..."

    helm repo add prometheus-community \
        https://prometheus-community.github.io/helm-charts \
        --force-update

    helm repo update

    kubectl create namespace monitoring \
        --dry-run=client -o yaml | kubectl apply -f -

    helm upgrade --install prometheus \
        prometheus-community/kube-prometheus-stack \
        --namespace monitoring

    echo ""
    echo "Prometheus Stack installation completed."

fi

# ==========================================
# 5. ArgoCD Installation
# ==========================================

if ask_install "ArgoCD"; then

    echo ""
    echo "Installing ArgoCD..."

    helm repo add argo \
        https://argoproj.github.io/argo-helm \
        --force-update

    helm repo update

    helm upgrade --install argocd \
        argo/argo-cd \
        --namespace argocd \
        --create-namespace

    echo ""
    echo "ArgoCD installation completed."

fi

# ==========================================
# 6. NGINX Ingress Controller Installation
# ==========================================

if ask_install "NGINX Ingress Controller"; then

    echo ""
    echo "Installing NGINX Ingress Controller..."

    helm upgrade --install ingress-nginx ingress-nginx \
        --repo https://kubernetes.github.io/ingress-nginx \
        --namespace ingress-nginx \
        --create-namespace

    echo ""
    echo "NGINX Ingress Controller installation completed."

fi

# ==========================================
# 7. Installation Summary
# ==========================================

echo ""
echo "=========================================="
echo " Installation Process Finished"
echo "=========================================="

echo ""
echo "========== HELM RELEASES =========="
helm list -A

echo ""
echo "========== NAMESPACES ============="
kubectl get namespaces

echo ""
echo "========== ALL PODS ==============="
kubectl get pods -A

echo ""
echo "All requested installations have been processed."

