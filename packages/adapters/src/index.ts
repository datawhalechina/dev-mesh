import type { ConfigureInput, ConfigureResult, DoctorCheck, RemoveInput, ToolAdapter } from '@mcp-dev-mesh/extension-api';

export type BuiltInToolAdapterId = 'codex' | 'claude-code' | 'opencode';

export function createPlaceholderToolAdapter(id: BuiltInToolAdapterId): ToolAdapter {
  return {
    id: `dev-mesh.adapter.${id}`,
    kind: 'tool-adapter',
    capabilities: ['tool.detect', 'mcp.configure'],
    priority: 10,
    async detect() {
      return {
        detected: false,
        name: id,
        reason: 'Adapter scaffold is registered; host-specific detection is not implemented yet.'
      };
    },
    async isConfigured() {
      return false;
    },
    async configure(input: ConfigureInput): Promise<ConfigureResult> {
      return {
        changed: false,
        message: `Would configure ${id} for ${input.mcpUrl}`
      };
    },
    async remove(_input: RemoveInput): Promise<void> {
      return;
    },
    async doctor(): Promise<DoctorCheck[]> {
      return [
        {
          id: `adapter.${id}.scaffold`,
          status: 'warn',
          message: `${id} adapter is scaffolded but not fully implemented.`
        }
      ];
    }
  };
}

export function createBuiltInAdapters(): ToolAdapter[] {
  return (['codex', 'claude-code', 'opencode'] as const).map((id) => createPlaceholderToolAdapter(id));
}
