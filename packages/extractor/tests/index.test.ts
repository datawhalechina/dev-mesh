import type { RawEvent } from '@devmesh/extension-api';
import { describe, expect, it } from 'vitest';
import { createRuleBasedExtractor } from '../src/index.js';

describe('createRuleBasedExtractor', () => {
  it('extracts task progress and test command proposals from git snapshots', async () => {
    const extractor = createRuleBasedExtractor();
    const event: RawEvent = {
      id: 'raw_git_1',
      kind: 'git.snapshot',
      summary: 'Git snapshot on feature/AUTH-123-login at abc1234: 2 changed files.',
      createdAt: '2026-06-06T10:00:00.000Z',
      payload: {
        branch: 'feature/AUTH-123-login',
        headCommit: 'abcdef1234567890',
        headSubject: 'AUTH-123 wire login capture',
        issueKeys: ['AUTH-123'],
        changedFiles: [
          {
            path: 'src/auth/session.ts',
            status: 'M',
            additions: 12,
            deletions: 2
          },
          {
            path: 'tests/auth/session.test.ts',
            status: 'M',
            additions: 4,
            deletions: 1
          }
        ],
        testResult: {
          command: 'pnpm test auth',
          passed: true,
          summary: '12 tests passed'
        }
      }
    };

    expect(extractor.supports(event)).toBe(true);

    const proposals = await extractor.extract({ event, projectRoot: process.cwd() });

    expect(proposals).toHaveLength(2);
    expect(proposals[0]).toMatchObject({
      type: 'task_progress',
      title: 'AUTH-123 git progress',
      para: {
        category: 'projects',
        key: 'AUTH-123'
      },
      tags: ['git.snapshot', 'git', 'task-progress', 'AUTH-123'],
      metadata: {
        risk: 'low',
        sourceEventId: 'raw_git_1',
        sourceEventKind: 'git.snapshot',
        evidence: {
          branch: 'feature/AUTH-123-login',
          changedFileCount: 2,
          issueKeys: ['AUTH-123']
        }
      }
    });
    expect(proposals[0]?.summary).toContain('Changed files with +16/-3');
    expect(proposals[1]).toMatchObject({
      type: 'command',
      title: 'Test command passed: pnpm test auth',
      para: {
        category: 'resources',
        key: 'test-commands'
      },
      metadata: {
        risk: 'low'
      }
    });
  });

  it('extracts workspace activity and marker proposals from filesystem snapshots', async () => {
    const extractor = createRuleBasedExtractor();
    const event: RawEvent = {
      id: 'raw_fs_1',
      kind: 'filesystem.snapshot',
      summary: 'Filesystem snapshot: 2 files observed. TODO/FIXME markers: 1 TODO, 1 FIXME.',
      createdAt: '2026-06-06T10:05:00.000Z',
      payload: {
        files: [
          {
            path: 'src/auth/session.ts',
            category: 'source',
            markers: {
              todo: 1,
              fixme: 1
            }
          },
          {
            path: 'docs/auth.md',
            category: 'docs'
          }
        ],
        ignored: {
          meshignore: 1,
          privacy: 2
        },
        truncated: false
      }
    };

    const proposals = await extractor.extract({ event, projectRoot: process.cwd() });

    expect(proposals).toHaveLength(2);
    expect(proposals[0]).toMatchObject({
      type: 'task_progress',
      title: 'Workspace file activity in src/auth',
      para: {
        category: 'areas',
        key: 'src/auth'
      },
      metadata: {
        risk: 'low',
        evidence: {
          fileCount: 2,
          truncated: false
        }
      }
    });
    expect(proposals[0]?.summary).toContain('Categories: docs=1, source=1.');
    expect(proposals[1]).toMatchObject({
      type: 'task_progress',
      title: 'TODO/FIXME markers changed in workspace',
      para: {
        category: 'projects',
        key: 'active-task'
      },
      tags: ['filesystem.snapshot', 'todo', 'fixme', 'task-progress'],
      metadata: {
        risk: 'medium',
        evidence: {
          todo: 1,
          fixme: 1,
          files: ['src/auth/session.ts']
        }
      }
    });
  });

  it('extracts failed MCP tool calls as pitfall proposals without argument values', async () => {
    const extractor = createRuleBasedExtractor();
    const event: RawEvent = {
      id: 'raw_mcp_1',
      kind: 'mcp.tool_call',
      summary: 'MCP tool mesh_capture_knowledge failed: Authorization: Bearer [REDACTED:authorization].',
      createdAt: '2026-06-06T10:10:00.000Z',
      payload: {
        toolName: 'mesh_capture_knowledge',
        failed: true,
        status: 'failed',
        argumentKeys: ['summary', 'token'],
        error: {
          code: 'E_AUTH',
          message: 'Authorization: Bearer [REDACTED:authorization]'
        }
      }
    };

    const proposals = await extractor.extract({ event, projectRoot: process.cwd() });

    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      type: 'pitfall',
      title: 'MCP tool mesh_capture_knowledge failed',
      para: {
        category: 'resources',
        key: 'mcp-tools'
      },
      metadata: {
        risk: 'medium',
        evidence: {
          toolName: 'mesh_capture_knowledge',
          failed: true,
          argumentKeys: ['summary', 'token']
        }
      }
    });
    expect(JSON.stringify(proposals)).not.toContain('super-secret-token');
  });
});
