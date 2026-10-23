# Evergreen Insurance Agency — Kubernetes Manifests

Kubernetes manifests and Kustomize overlays for running the 8 Evergreen Insurance Agency microservices backed by a CloudNativePG PostgreSQL cluster.

## Prerequisites

1. **Kubernetes cluster** (v1.27+ recommended: GKE, kind, minikube, or k3s)
2. **CloudNativePG Operator** installed in the cluster:
   ```bash
   kubectl apply --server-side -f \
     https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-1.23/releases/cnpg-1.23.1.yaml
   kubectl wait --for=condition=Available deployment/cnpg-controller-manager \
     -n cnpg-system --timeout=120s
   ```
3. **Service images built** (`evergreen/<service>:latest` for all 8 services):
   ```bash
   docker compose build
   ```

## Architecture

- **`postgres.yaml`**: CloudNativePG `Cluster` (`evergreen-pg`) with 1 instance (`2Gi` storage) that bootstraps the `ams` database (`owner: evergreen`) and runs `postInitApplicationSQL` to create the remaining 7 databases (`rater`, `crm`, `ecm`, `comm`, `carrier_summit`, `carrier_coastal`, `claims`).
- **`configmap.yaml`**: `evergreen-config` ConfigMap holding `SEED_MODE`, `MODALITY_MODE`, and internal service URLs (`http://<service>:<port>`).
- **`secret.yaml`**: `evergreen-secrets` Secret containing `JWT_SECRET` and per-service PostgreSQL connection strings (`DATABASE_URL_<SERVICE>`).
- **`services/*.yaml`**: Deployment and ClusterIP Service manifests for all 8 microservices (`ams` :3000, `rater` :3001, `crm` :3002, `ecm` :3003, `comm` :3004, `carrier-summit` :3005, `carrier-coastal` :3006, `claims` :3007) with `/health` HTTP liveness and readiness probes.
- **`seed-job.yaml`**: Kubernetes `Job` (`evergreen-seed-job`) that waits for `evergreen-pg-rw:5432` and seeds all 8 databases according to `SEED_MODE`.

## Deployment

### Realistic Seed Mode (Default — Includes Adversarial E&O Traps)

```bash
kubectl apply -k k8s/overlays/realistic
```

### Clean Seed Mode (No Planted Issues or E&O Traps)

```bash
kubectl apply -k k8s/overlays/clean
```

### With External Ingress (`evergreen.local`)

```bash
kubectl apply -k k8s/overlays/ingress
```

## Resetting Database State

To reset all 8 PostgreSQL databases back to their initial seed state without redeploying the cluster:

```bash
kubectl delete job evergreen-seed-job --ignore-not-found
kubectl apply -f k8s/seed-job.yaml
kubectl wait --for=condition=complete job/evergreen-seed-job --timeout=120s
```
