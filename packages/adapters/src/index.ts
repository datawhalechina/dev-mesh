import type { ToolAdapter } from '@devmesh/extension-api';
import { createClaudeCodeToolAdapter, type ClaudeCodeToolAdapterOptions } from './claude-code.js';
import { createCodexToolAdapter, type CodexToolAdapterOptions } from './codex.js';
import { createOpencodeToolAdapter, type OpencodeToolAdapterOptions } from './opencode.js';

export type BuiltInToolAdapterId = 'codex' | 'claude-code' | 'opencode';

export interface BuiltInAdapterOptions {
  claudeCode?: ClaudeCodeToolAdapterOptions;
  codex?: CodexToolAdapterOptions;
  opencode?: OpencodeToolAdapterOptions;
}

export function createBuiltInAdapters(options: BuiltInAdapterOptions = {}): ToolAdapter[] {
  return [
    createCodexToolAdapter(options.codex),
    createClaudeCodeToolAdapter(options.claudeCode),
    createOpencodeToolAdapter(options.opencode)
  ];
}

export { createClaudeCodeToolAdapter, type ClaudeCodeToolAdapterOptions };
export { createCodexToolAdapter, type CodexToolAdapterOptions };
export { createOpencodeToolAdapter, type OpencodeToolAdapterOptions };
