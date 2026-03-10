/**
 * E2E test environment configuration.
 *
 * Docker-compose mode (default): services on localhost ports 3000-3006
 * K8s mode: set K8S_BASE_URL to the ingress base URL
 */

export const K8S_MODE = !!process.env.K8S_BASE_URL;

const SERVICE_PORTS: Record<string, number> = {
  ams: 3000,
  rater: 3001,
  crm: 3002,
  ecm: 3003,
  comm: 3004,
  "carrier-summit": 3005,
  "carrier-coastal": 3006,
};

export type ServiceName = keyof typeof SERVICE_PORTS;

export function getServiceUrl(service: ServiceName): string {
  if (K8S_MODE) {
    return `${process.env.K8S_BASE_URL}/${service}`;
  }
  const port = SERVICE_PORTS[service];
  if (!port) throw new Error(`Unknown service: ${service}`);
  return `http://localhost:${port}`;
}

export const ALL_SERVICES: ServiceName[] = Object.keys(SERVICE_PORTS) as ServiceName[];
