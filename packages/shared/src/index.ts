export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export const DEV_MESH_VERSION = '0.1.6';

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export class DevMeshError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'DevMeshError';
    this.code = code;

    if (details !== undefined) {
      this.details = details;
    }
  }
}

export function invariant(
  condition: unknown,
  code: string,
  message: string,
  details?: Record<string, unknown>
): asserts condition {
  if (!condition) {
    throw new DevMeshError(code, message, details);
  }
}

export function createConsoleLogger(namespace = 'devmesh'): Logger {
  const write = (level: LogLevel, message: string, meta?: Record<string, unknown>) => {
    const suffix = meta ? ` ${JSON.stringify(meta)}` : '';
    const line = `[${namespace}] ${level}: ${message}${suffix}`;

    if (level === 'error') {
      console.error(line);
      return;
    }

    if (level === 'warn') {
      console.warn(line);
      return;
    }

    console.log(line);
  };

  return {
    debug: (message, meta) => write('debug', message, meta),
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta)
  };
}

export function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

export function nowIso(): string {
  return new Date().toISOString();
}
