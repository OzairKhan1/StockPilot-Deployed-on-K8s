# StockPilot

### App Help and  Tools Instalation
1: Create a Cluster
2: The Repo has a Script with name "tool.sh" run the script to install tools
3: Run this command to update the configs for Tools like argocd, prometheus and grafana
```
helm upgrade prometheus-stack prometheus-community/kube-prometheus-stack \
  -n monitoring --reuse-values -f prom-values.yaml
```
``` 


Warehouse inventory & reorder tracking, built as a cloud-native 3-tier app for Kubernetes.
Track physical stock (receive / ship / cycle-count), get low-stock alerts with suggested
reorder quantities, and keep an audit trail of every movement.

```
Browser ──► Ingress ──► frontend (nginx, static UI) ──/api──► backend (Node/Express) ──► MongoDB
                                                                  │
                                                          /metrics ──► Prometheus ──► Grafana
```

## Features
- Product catalog with aisle-shelf-bin locations, units, reorder levels, unit cost
- Atomic stock movements (IN / OUT / ADJUST): stock can never go negative
- Dashboard: units on hand, inventory value, stock by category, reorder alerts, activity feed
- CSV export, search and filtering
- Prometheus metrics: HTTP latency histogram, `stockpilot_low_stock_products`, `stockpilot_inventory_units`
- Structured JSON request logs, readiness/liveness endpoints, graceful shutdown, DB retry with backoff

## API
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health`, `/api/live` | readiness (DB-aware) / liveness |
| GET | `/api/stats` | dashboard numbers |
| GET/POST | `/api/products` | list (`?status=low`) / create |
| PUT/DELETE | `/api/products/:id` | edit / delete |
| POST | `/api/products/:id/movements` | `{type: IN\|OUT\|ADJUST, quantity, note}` |
| GET | `/api/movements` | recent activity (`?limit=`, `?sku=`) |
| GET | `/metrics` | Prometheus metrics |

## Run on Kubernetes
```bash
docker build -t <user>/stockpilot-api:v1 ./backend && docker push <user>/stockpilot-api:v1
docker build -t <user>/stockpilot-web:v1 ./frontend && docker push <user>/stockpilot-web:v1
kubectl create ns app-ns
kubectl apply -n app-ns -f manifest/
```

## Roadmap
- CI: GitHub Actions (build, test, Trivy scan, push), GitOps deploy with Argo CD
- Helm chart, HPA, NetworkPolicies, MongoDB auth via Secrets, TLS via cert-manager
- Grafana dashboard for stock KPIs and API latency
