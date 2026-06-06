import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('web-admin app structure', () => {
  it('declares the required management views and actions', async () => {
    const source = await readFile(join(import.meta.dirname, '..', 'src', 'App.vue'), 'utf8');

    expect(source).toContain("key: 'overview'");
    expect(source).toContain("key: 'groups'");
    expect(source).toContain("key: 'members'");
    expect(source).toContain("key: 'invites'");
    expect(source).toContain("key: 'projects'");
    expect(source).toContain("key: 'glossary'");
    expect(source).toContain("key: 'knowledge'");
    expect(source).toContain("key: 'edges'");
    expect(source).toContain("key: 'review'");
    expect(source).toContain("key: 'audit'");
    expect(source).toContain('submitGroup');
    expect(source).toContain('submitInvite');
    expect(source).toContain('submitProject');
    expect(source).toContain('openProjectAcl');
    expect(source).toContain('submitProjectAcl');
    expect(source).toContain('openGlossaryDialog');
    expect(source).toContain('submitGlossary');
    expect(source).toContain('openEdgeDialog');
    expect(source).toContain('submitEdge');
    expect(source).toContain('Include Superseded');
    expect(source).toContain('disableMemberRow');
    expect(source).toContain('revokeInviteRow');
  });
});
