import { describe, expect, it } from 'vitest';
import { createDoctorCategorySummary, createDoctorOverview } from '../src/commands/doctor.js';
import type { DevMeshDoctorResult } from '@mcp-dev-mesh/client';

describe('doctor TUI helpers', () => {
  it('formats the doctor overview as readable text', () => {
    expect(createDoctorOverview(doctorResult())).toBe(
      [
        'Project root: C:\\repo',
        'Global root: C:\\Users\\xiaoyun\\.dev-mesh',
        'Checks: 1 ok, 1 warn, 0 error'
      ].join('\n')
    );
  });

  it('formats grouped doctor checks with fix hints', () => {
    expect(createDoctorCategorySummary(doctorResult().checks)).toBe(
      [
        'OK Project store is available.',
        '',
        'WARN Codex MCP server is not configured.',
        'Fix: Run dmx init --global --tool codex --yes.'
      ].join('\n')
    );
  });
});

function doctorResult(): DevMeshDoctorResult {
  return {
    projectRoot: 'C:\\repo',
    globalRoot: 'C:\\Users\\xiaoyun\\.dev-mesh',
    summary: {
      ok: 1,
      warn: 1,
      error: 0
    },
    checks: [
      {
        id: 'store.available',
        category: 'store',
        status: 'ok',
        message: 'Project store is available.'
      },
      {
        id: 'adapter.codex',
        category: 'adapter',
        status: 'warn',
        message: 'Codex MCP server is not configured.',
        fixHint: 'Run dmx init --global --tool codex --yes.'
      }
    ]
  };
}
