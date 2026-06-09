import type { ErrorResponse, JoinRequest, JoinResponse, WellKnownDevMesh } from '@devmesh/protocol';

export interface JoinEndpoint {
  serverUrl: string;
  mcpUrl: string;
}

export async function discoverJoinEndpoint(serverUrl: string): Promise<JoinEndpoint> {
  const discoveryUrl = normalizeServerUrl(serverUrl);
  const wellKnown = await fetchWellKnown(discoveryUrl);
  const baseUrl = normalizeServerUrl(wellKnown.baseUrl || discoveryUrl);

  return {
    serverUrl: baseUrl,
    mcpUrl: wellKnown.mcpUrl
  };
}

async function fetchWellKnown(discoveryUrl: string): Promise<WellKnownDevMesh> {
  try {
    return await fetchJson<WellKnownDevMesh>(`${discoveryUrl}/.well-known/devmesh`);
  } catch (error) {
    return await fetchJson<WellKnownDevMesh>(`${discoveryUrl}/.well-known/dev-mesh`);
  }
}

export async function requestServerJoin(serverUrl: string, request: JoinRequest): Promise<JoinResponse> {
  return fetchJson<JoinResponse>(`${serverUrl}/api/v1/join`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(request)
  });
}

function normalizeServerUrl(value: string): string {
  const trimmed = value.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const url = new URL(withProtocol);

  return url.toString().replace(/\/$/, '');
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => ({}))) as T | ErrorResponse;

  if (!response.ok) {
    const error = (payload as ErrorResponse).error;
    throw new Error(error ? `${error.code}: ${error.message}` : `Request failed with ${response.status}`);
  }

  return payload as T;
}
