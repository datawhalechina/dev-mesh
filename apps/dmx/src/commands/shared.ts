import type { ParaCategory } from '@mcp-dev-mesh/core';

export function parseIntOption(value: string): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected an integer, received ${value}`);
  }

  return parsed;
}

export function parseNumberOption(value: string): number {
  const parsed = Number.parseFloat(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected a number, received ${value}`);
  }

  return parsed;
}

export function createReviewOptions(reason?: string): { reason?: string } {
  if (reason === undefined) {
    return {};
  }

  return {
    reason
  };
}

export function createRateOptions(reason?: string): { reason?: string } {
  if (reason === undefined) {
    return {};
  }

  return {
    reason
  };
}

export function shouldUseTuiOutput(options: { json?: boolean | undefined } = {}): boolean {
  if (options.json) {
    return false;
  }

  return !isCiEnvironment() && process.stdout.isTTY === true;
}

export function isCiEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.CI;

  if (value === undefined) {
    return false;
  }

  const normalized = value.trim().toLowerCase();

  return normalized.length > 0 && normalized !== '0' && normalized !== 'false';
}

export function requireInboxId(id: string | undefined, action: string): string {
  if (!id) {
    throw new Error(`Expected an inbox item id for inbox ${action}.`);
  }

  return id;
}

export function parsePara(value?: string): { category: ParaCategory; key: string } | undefined {
  if (!value) {
    return undefined;
  }

  const [category, ...keyParts] = value.split(':');
  const key = keyParts.join(':');

  if (!isParaCategory(category) || !key) {
    throw new Error('Expected --para in the form category:key');
  }

  return {
    category,
    key
  };
}

function isParaCategory(value: string | undefined): value is ParaCategory {
  return value === 'projects' || value === 'areas' || value === 'resources' || value === 'archives';
}
