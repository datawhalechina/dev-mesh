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
        'High-risk automatic extraction.',
        '--title',
        'Review accepted candidate',
        '--summary',
        'Accepted inbox items should become searchable knowledge.',
        '--type',
        'decision'
      ]);
      const queuedJson = JSON.parse(queued.stdout);
      const inbox = await runDmx(['inbox', '--root', projectRoot]);
      const inboxJson = JSON.parse(inbox.stdout);

      expect(queuedJson).toMatchObject({
        kind: 'knowledge',
        risk: 'high',
        reason: 'High-risk automatic extraction.',
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

      const accepted = await runDmx(['inbox', 'accept', queuedJson.id, '--root', projectRoot]);
      const acceptedJson = JSON.parse(accepted.stdout);
      const search = await runDmx(['search', 'accepted candidate', '--root', projectRoot]);
      const searchJson = JSON.parse(search.stdout);
      const emptyInbox = JSON.parse((await runDmx(['inbox', 'list', '--root', projectRoot])).stdout);

      expect(acceptedJson.item).toMatchObject({
        id: queuedJson.input.id,
        title: 'Review accepted candidate'
      });
      expect(searchJson.items[0]).toMatchObject({
        id: queuedJson.input.id,
        title: 'Review accepted candidate'
      });
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
            'pitfall'
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
        'Not durable enough.'
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
