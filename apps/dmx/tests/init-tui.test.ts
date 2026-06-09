import { describe, expect, it } from 'vitest';
import {
  createGlobalInitDefaultTools,
  createGlobalInitResultSummary,
  createGlobalInitStatusSummary,
  createGlobalInitToolChoices,
  createGlobalInitToolsSummary,
  createProjectInitResultSummary
} from '../src/commands/init.js';
import type { GlobalInitResult, GlobalToolStatus } from '@devmesh/client';

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

  it('formats global init result summaries without dumping JSON', () => {
    const result: GlobalInitResult = {
      globalRoot: 'C:\\Users\\xiaoyun\\.dev-mesh',
      configPath: 'C:\\Users\\xiaoyun\\.dev-mesh\\config.toml',
      identityPath: 'C:\\Users\\xiaoyun\\.dev-mesh\\identity.json',
      selectedTools: ['codex'],
      tools: [
        toolStatus({
          key: 'codex',
          displayName: 'Codex',
          selected: true,
          detected: true,
          configured: true,
          targetPath: 'C:\\Users\\xiaoyun\\.codex\\config.toml'
        }),
        toolStatus({
          key: 'opencode',
          displayName: 'opencode',
          selected: false
        })
      ]
    };

    expect(createGlobalInitResultSummary(result)).toContain('Selected tools: codex');
    expect(createGlobalInitResultSummary(result)).toContain(
      'Automation: auto_init, auto_reference, auto_capture, auto_sync'
    );
    expect(createGlobalInitToolsSummary(result.tools)).toBe(
      'Codex        configured (user) -> C:\\Users\\xiaoyun\\.codex\\config.toml'
    );
  });

  it('formats project init result summaries', () => {
    expect(
      createProjectInitResultSummary({
        projectRoot: 'C:\\repo',
        storeRoot: 'C:\\repo\\.dev-mesh',
        paths: {
          config: 'C:\\repo\\.dev-mesh\\config.toml',
          eventsDir: 'C:\\repo\\.dev-mesh\\events',
          knowledgeDir: 'C:\\repo\\.dev-mesh\\knowledge'
        }
      })
    ).toContain('Store root: C:\\repo\\.dev-mesh');
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
