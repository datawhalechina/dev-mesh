import { randomUUID } from 'node:crypto';
import type { HubAuditLog, HubState } from './hub-model.js';

export interface HubAuditInput {
  actor: string;
  action: string;
  targetType: string;
  targetId: string;
  branch?: string;
  payload?: Record<string, unknown>;
}

export function appendHubAuditLog(state: HubState, input: HubAuditInput): HubAuditLog {
  const log: HubAuditLog = {
    id: `audit_${randomUUID().replace(/-/g, '')}`,
    actor: input.actor,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    createdAt: new Date().toISOString()
  };

  if (input.branch !== undefined) {
    log.branch = input.branch;
  }

  if (input.payload !== undefined) {
    log.payload = input.payload;
  }

  state.auditLogs.push(log);

  return log;
}
