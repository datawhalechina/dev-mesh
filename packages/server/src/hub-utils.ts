import type { HubResult } from './hub-model.js';

export function countByGroup(values: Iterable<{ groupKey: string }>, groupKey: string): number {
  let count = 0;

  for (const value of values) {
    if (value.groupKey === groupKey) {
      count += 1;
    }
  }

  return count;
}

export function projectMapKey(groupKey: string, projectId: string): string {
  return `${groupKey}:${projectId}`;
}

export function ok<T>(value: T): HubResult<T> {
  return {
    ok: true,
    value
  };
}

export function hubError(statusCode: number, code: string, message: string): HubResult<never> {
  return {
    ok: false,
    error: {
      statusCode,
      code,
      message
    }
  };
}

export function isExpired(value: string | undefined): boolean {
  return value !== undefined && Date.parse(value) <= Date.now();
}

export function slugHandle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}
