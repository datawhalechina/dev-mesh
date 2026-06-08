import { describe, expect, it } from 'vitest';
import {
  createGlobalInitDefaultTools,
  createGlobalInitStatusSummary,
  createGlobalInitToolChoices
} from '../src/commands/init.js';
import type { GlobalToolStatus } from '@mcp-dev-mesh/client';

describe('global init TUI helpers', () => {
  it('builds Clack choices with detected/configured hints', () => {
    const statuses = [
      toolStatus({
        key: 'codex',
        displayName: 'Codex',
        detected: true,
        configured: false
      }),
      toolStatus({
        key: 'claude',
        adapterId: 'claude-code',
        displayName: 'Claude Code',
        detected: true,
        configured: true,
        scope: 'project'
      }),
      toolStatus({
        key: 'opencode',
        displayName: 'opencode',
        detected: false,
        configured: false,
        reason: 'opencode CLI was not found.'
      })
    ];

    expect(createGlobalInitDefaultTools(statuses)).toEqual(['codex', 'claude']);
    expect(createGlobalInitToolChoices(statuses)).toEqual([
      {
        value: 'codex',
        label: 'Codex',
        hint: 'installed, not configured | scope: user'
      },
      {
        value: 'claude',
        label: 'Claude Code',
        hint: 'installed, already configured | scope: project'
      },
      {
        value: 'opencode',
        label: 'opencode',
        hint: 'not found | scope: user | opencode CLI was not found.'
      }
    ]);
  });

  it('formats a compact detected tool summary', () => {
    const summary = createGlobalInitStatusSummary([
      toolStatus({
        key: 'codex',
        displayName: 'Codex',
        detected: true,
        configured: false
      }),
      toolStatus({
        key: 'opencode',
        displayName: 'opencode',
        detected: false,
        configured: false
      })
    ]);

    expect(summary).toContain('Codex        installed, not configured (user)');
    expect(summary).toContain('opencode     not found (user)');
  });
});

function toolStatus(overrides: Partial<GlobalToolStatus> & Pick<GlobalToolStatus, 'key' | 'displayName'>): GlobalToolStatus {
  return {
    adapterId: overrides.key === 'claude' ? 'claude-code' : overrides.key,
    selected: false,
    detected: false,
    configured: false,
    scope: 'user',
    ...overrides
  };
}
