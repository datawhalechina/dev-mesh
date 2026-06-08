import type { ProjectConfig } from '@mcp-dev-mesh/local-store';

export type DevMeshDoctorStatus = 'ok' | 'warn' | 'error';
export type DevMeshDoctorCategory = 'adapter' | 'capture' | 'store' | 'sync' | 'privacy' | 'proxy';

export interface DevMeshDoctorOptions {
  projectRoot?: string;
  globalRoot?: string;
  mcpUrl?: string;
}

export interface DevMeshDoctorCheck {
  id: string;
  category: DevMeshDoctorCategory;
  status: DevMeshDoctorStatus;
  message: string;
  fixHint?: string | undefined;
}

export interface DevMeshDoctorResult {
  projectRoot: string;
  globalRoot: string;
  summary: Record<DevMeshDoctorStatus, number>;
  checks: DevMeshDoctorCheck[];
}

export interface DoctorContext {
  projectRoot: string;
  globalRoot: string;
  mcpUrl: string;
  projectConfig?: ProjectConfig;
}

export interface GlobalIdentity {
  selectedTools?: string[];
  joinedServers?: JoinedServerIdentity[];
  [key: string]: unknown;
}

export interface JoinedServerIdentity {
  serverUrl?: string;
  groupKey?: string;
  clientId?: string;
  accessToken?: string;
}
