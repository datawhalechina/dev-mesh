import { describe, expect, it } from 'vitest';
import { applyGlobalInitTuiKey, createGlobalInitTuiState, renderGlobalInitTui } from '../src/commands/init.js';
import type { GlobalToolStatus } from '@mcp-dev-mesh/client';

describe('global init TUI state', () => {
  it('renders detected/configured status and supports selection and scope keys', () => {
    const state = createGlobalInitTuiState([
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
        configured: true
      }),
      toolStatus({
        key: 'opencode',
        displayName: 'opencode',
        detected: false,
        configured: false
      })
    ]);

    expect(renderGlobalInitTui(state)).toContain('[x] Codex        installed, not configured');
    expect(renderGlobalInitTui(state)).toContain('[x] Claude Code  installed, already configured');
    expect(renderGlobalInitTui(state)).toContain('[ ] opencode     not found');
    expect(renderGlobalInitTui(state)).toContain('auto_capture');

    const moved = applyGlobalInitTuiKey(state, 'down').state;
    const scoped = applyGlobalInitTuiKey(moved, 'scope').state;
    const toggled = applyGlobalInitTuiKey(scoped, 'space').state;
    const applied = applyGlobalInitTuiKey(toggled, 'enter');

    expect(scoped.items[1]).toMatchObject({
      key: 'claude',
      scope: 'project'
    });
    expect(toggled.items[1]).toMatchObject({
      key: 'claude',
      selected: false
    });
    expect(applied.selection).toEqual({
      tools: ['codex'],
      toolScopes: {
        codex: 'user'
      }
    });
  });

  it('keeps the TUI open when no MCP host tools are selected', () => {
    const state = createGlobalInitTuiState([
      toolStatus({
        key: 'codex',
        displayName: 'Codex',
        detected: true,
        configured: false
      })
    ]);
    const unselected = applyGlobalInitTuiKey(state, 'space').state;
    const applied = applyGlobalInitTuiKey(unselected, 'enter');

    expect(applied.selection).toBeUndefined();
    expect(applied.state.error).toContain('Select at least one');
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
