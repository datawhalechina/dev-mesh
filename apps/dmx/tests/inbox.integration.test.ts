import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runDmx } from './run-dmx.js';

describe('dmx CLI inbox flow', () => {
  it('queues high-risk captures and reviews them from inbox', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-cli-'));

    try {
      const queued = await runDmx([
        'capture',
        '--root',
        projectRoot,
        '--name',
        'Xiaoyun',
        '--review',
        '--reason',
        'High-risk knowledge capture.',
        '--title',
        'Review accepted candidate',
        '--summary',
        'Accepted inbox items should become searchable knowledge.',
        '--type',
        'decision',
        '--json'
      ]);
      const queuedJson = JSON.parse(queued.stdout);
      const inbox = await runDmx(['inbox', '--root', projectRoot, '--json']);
      const inboxJson = JSON.parse(inbox.stdout);
      const inboxText = await runDmx(['inbox', '--root', projectRoot]);

      expect(queuedJson).toMatchObject({
        kind: 'knowledge',
        risk: 'high',
        reason: 'High-risk knowledge capture.',
        input: {
          title: 'Review accepted candidate',
          createdBy: {
            displayName: 'Xiaoyun'
          }
        }
      });
      expect(inboxJson.items).toHaveLength(1);
      expect(inboxJson.items[0]).toMatchObject({
        id: queuedJson.id,
        input: {
          title: 'Review accepted candidate'
        }
      });
      expect(inboxText.stdout).toContain('DevMesh inbox');
      expect(inboxText.stdout).toContain(`id=${queuedJson.id}`);
      expect(inboxText.stdout).toContain('risk=high');
      expect(inboxText.stdout.trim()).not.toMatch(/^\{/);

      const accepted = await runDmx(['inbox', 'accept', queuedJson.id, '--root', projectRoot, '--json']);
      const acceptedJson = JSON.parse(accepted.stdout);
      const usageAfterAcceptJsonl = await readFile(
        join(projectRoot, '.dev-mesh', 'knowledge', 'usage', `${acceptedJson.item.updatedAt.slice(0, 7)}.jsonl`),
        'utf8'
      );
      const search = await runDmx(['search', 'accepted candidate', '--root', projectRoot, '--json']);
      const searchJson = JSON.parse(search.stdout);
      const emptyInbox = JSON.parse((await runDmx(['inbox', 'list', '--root', projectRoot, '--json'])).stdout);

      expect(acceptedJson.item).toMatchObject({
        id: queuedJson.input.id,
        title: 'Review accepted candidate'
      });
      expect(searchJson.items[0]).toMatchObject({
        id: queuedJson.input.id,
        title: 'Review accepted candidate'
      });
      expect(usageAfterAcceptJsonl).toContain('"kind":"review.accepted"');
      expect(usageAfterAcceptJsonl).toContain(`"knowledgeId":"${queuedJson.input.id}"`);
      expect(emptyInbox.items).toHaveLength(0);

      const rejectedQueue = JSON.parse(
        (
          await runDmx([
            'capture',
            '--root',
            projectRoot,
            '--review',
            '--title',
            'Reject noisy candidate',
            '--summary',
            'This item should stay out of knowledge.',
            '--type',
            'pitfall',
            '--json'
          ])
        ).stdout
      );
      const rejected = await runDmx([
        'inbox',
        'reject',
        rejectedQueue.id,
        '--root',
        projectRoot,
        '--reason',
        'Not durable enough.',
        '--json'
      ]);
      const rejectedJson = JSON.parse(rejected.stdout);
      const rejectedJsonl = await readFile(join(projectRoot, '.dev-mesh', 'queue', 'rejected.jsonl'), 'utf8');

      expect(rejectedJson.queueItem).toMatchObject({
        id: rejectedQueue.id,
        status: 'rejected',
        rejectedReason: 'Not durable enough.'
      });
      expect(rejectedJsonl).toContain('"title":"Reject noisy candidate"');
      expect(rejectedJsonl).toContain('"status":"rejected"');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  }, 30000);
});
