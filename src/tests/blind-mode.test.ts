/**
 * Integration tests for blind review mode.
 *
 * Blind mode hides review marks (comments/suggestions) from everyone except
 * their author until the document owner flips the reveal switch. The owner
 * sees all marks throughout.
 *
 * Run: npm run test:blind-mode
 */

import { unlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const CLIENT_HEADERS = {
  'X-Proof-Client-Version': '0.31.0',
  'X-Proof-Client-Build': 'tests',
  'X-Proof-Client-Protocol': '3',
};

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(message ?? `Expected ${String(expected)}, got ${String(actual)}`);
  }
}

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${(error as Error).message}`);
  }
}

async function request(
  base: string,
  method: string,
  requestPath: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: any }> {
  const response = await fetch(`${base}${requestPath}`, {
    method,
    headers: {
      ...CLIENT_HEADERS,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { __raw: text };
  }
  return { status: response.status, json };
}

async function withEphemeralApiServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const dbName = `proof-blind-mode-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
  const dbPath = path.join(os.tmpdir(), dbName);
  process.env.DATABASE_PATH = dbPath;

  const { apiRoutes } = await import('../../server/routes.ts');
  const { agentRoutes } = await import('../../server/agent-routes.ts');
  const { createBridgeMountRouter } = await import('../../server/bridge.ts');
  const { enforceApiClientCompatibility } = await import('../../server/client-capabilities.ts');
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api', enforceApiClientCompatibility, apiRoutes);
  app.use('/api/agent', agentRoutes);
  app.use(apiRoutes);
  app.use('/documents', createBridgeMountRouter());
  app.use('/documents', agentRoutes);

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));

  try {
    const address = server.address();
    assert(address !== null && typeof address !== 'string', 'Server did not bind correctly');
    const baseUrl = `http://127.0.0.1:${(address as { port: number }).port}`;
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        unlinkSync(`${dbPath}${suffix}`);
      } catch {
        // ignore cleanup errors
      }
    }
  }
}

function markAuthors(marks: Record<string, { by?: string }> | undefined | null): string[] {
  return Object.values(marks ?? {}).map((mark) => mark.by ?? '').sort();
}

async function runBlindModeTests(): Promise<void> {
  await withEphemeralApiServer(async (base) => {
    // --- Setup: one blind doc with a comment each from alice and bob ---
    const created = await request(base, 'POST', '/api/documents', {
      markdown: '# Doc\n\nThe rain in Spain stays mainly in the plain.\n',
      title: 'Blind Test',
      blindMode: true,
    });
    assertEqual(created.status, 200, `create failed: ${JSON.stringify(created.json)}`);
    const slug = created.json.slug as string;
    const ownerSecret = created.json.ownerSecret as string;
    const accessToken = created.json.accessToken as string;
    assert(Boolean(slug && ownerSecret && accessToken), 'creation response missing slug/ownerSecret/accessToken');

    const aliceComment = await request(base, 'POST', `/documents/${slug}/bridge/comments`, {
      quote: 'rain in Spain',
      text: 'Citation needed for the rain claim.',
      by: 'human:alice',
    });
    const bobComment = await request(base, 'POST', `/documents/${slug}/bridge/comments`, {
      quote: 'mainly in the plain',
      text: 'Mostly, not mainly?',
      by: 'ai:bob',
    });

    await test('doc creation accepts blindMode and reports it on GET', async () => {
      const doc = await request(base, 'GET', `/api/documents/${slug}`);
      assertEqual(doc.status, 200);
      assertEqual(doc.json.blindMode, true);
      assertEqual(doc.json.revealedAt, null);
    });

    await test('comment authors see only their own marks via bridge', async () => {
      assertEqual(aliceComment.status, 200, `alice comment failed: ${JSON.stringify(aliceComment.json)}`);
      assertEqual(bobComment.status, 200, `bob comment failed: ${JSON.stringify(bobComment.json)}`);
      assertEqual(markAuthors(aliceComment.json.marks).join(','), 'human:alice', 'POST echo should be filtered to the author');

      const aliceMarks = await request(base, 'GET', `/documents/${slug}/bridge/marks`, undefined, { 'X-Agent-Id': 'human:alice' });
      assertEqual(markAuthors(aliceMarks.json.marks).join(','), 'human:alice');

      // Identity matching ignores the human:/ai: prefix and case.
      const bobMarks = await request(base, 'GET', `/documents/${slug}/bridge/marks`, undefined, { 'X-Agent-Id': 'Bob' });
      assertEqual(markAuthors(bobMarks.json.marks).join(','), 'ai:bob');
    });

    await test('anonymous readers see no review marks pre-reveal', async () => {
      const anonMarks = await request(base, 'GET', `/documents/${slug}/bridge/marks`);
      assertEqual(Object.keys(anonMarks.json.marks ?? {}).length, 0);

      const anonDoc = await request(base, 'GET', `/api/documents/${slug}`);
      assertEqual(Object.keys(anonDoc.json.marks ?? {}).length, 0);
    });

    await test('owner sees all marks pre-reveal', async () => {
      const ownerDoc = await request(base, 'GET', `/api/documents/${slug}`, undefined, { 'x-share-token': ownerSecret });
      assertEqual(markAuthors(ownerDoc.json.marks).join(','), 'ai:bob,human:alice');
    });

    await test('agent state route filters marks and reports blindMode', async () => {
      const state = await request(base, 'GET', `/api/agent/${slug}/state`, undefined, {
        'x-share-token': accessToken,
        'X-Agent-Id': 'human:alice',
      });
      assertEqual(state.status, 200, `state failed: ${JSON.stringify(state.json)}`);
      assertEqual(state.json.blindMode, true);
      assertEqual(state.json.revealedAt, null);
      assertEqual(markAuthors(state.json.marks).join(','), 'human:alice');
    });

    await test('event feed hides other reviewers\' comment events pre-reveal', async () => {
      const events = await request(base, 'GET', `/api/agent/${slug}/events/pending?after=0&limit=100`, undefined, {
        'x-share-token': accessToken,
        'X-Agent-Id': 'human:alice',
      });
      assertEqual(events.status, 200, `events failed: ${JSON.stringify(events.json)}`);
      const commentEvents = (events.json.events as Array<{ type: string; data: { by?: string } }>)
        .filter((event) => event.type.startsWith('comment.'));
      assert(commentEvents.length > 0, 'expected alice to see her own comment event');
      assert(
        commentEvents.every((event) => (event.data.by ?? '').includes('alice')),
        `expected only alice events, got ${JSON.stringify(commentEvents)}`,
      );
    });

    await test('bulk marks PUT cannot clobber marks hidden from the writer', async () => {
      const bobView = await request(base, 'GET', `/documents/${slug}/bridge/marks`, undefined, { 'X-Agent-Id': 'ai:bob' });
      const put = await request(base, 'PUT', `/api/documents/${slug}`, {
        marks: bobView.json.marks,
        actor: 'ai:bob',
      }, { 'x-share-token': accessToken });
      assertEqual(put.status, 200, `PUT failed: ${JSON.stringify(put.json)}`);

      const ownerDoc = await request(base, 'GET', `/api/documents/${slug}`, undefined, { 'x-share-token': ownerSecret });
      assertEqual(
        markAuthors(ownerDoc.json.marks).join(','),
        'ai:bob,human:alice',
        'alice\'s hidden mark should survive bob\'s full-map PUT',
      );
    });

    await test('reveal requires the owner', async () => {
      const denied = await request(base, 'POST', `/api/documents/${slug}/reveal`, {});
      assertEqual(denied.status, 403);
    });

    await test('after reveal everyone sees all marks', async () => {
      const revealed = await request(base, 'POST', `/api/documents/${slug}/reveal`, {}, { 'x-share-token': ownerSecret });
      assertEqual(revealed.status, 200, `reveal failed: ${JSON.stringify(revealed.json)}`);
      assert(Boolean(revealed.json.revealedAt), 'reveal should return revealedAt');

      const anonMarks = await request(base, 'GET', `/documents/${slug}/bridge/marks`);
      assertEqual(markAuthors(anonMarks.json.marks).join(','), 'ai:bob,human:alice');

      const doc = await request(base, 'GET', `/api/documents/${slug}`);
      assertEqual(doc.json.blindMode, true);
      assert(Boolean(doc.json.revealedAt), 'GET should report revealedAt after reveal');
    });

    await test('reveal is idempotent', async () => {
      const again = await request(base, 'POST', `/api/documents/${slug}/reveal`, {}, { 'x-share-token': ownerSecret });
      assertEqual(again.status, 200);
    });

    await test('non-blind documents are unaffected', async () => {
      const plain = await request(base, 'POST', '/api/documents', {
        markdown: '# Open doc\n\nEveryone can see everything here.\n',
      });
      assertEqual(plain.status, 200);
      const plainSlug = plain.json.slug as string;
      await request(base, 'POST', `/documents/${plainSlug}/bridge/comments`, {
        quote: 'Everyone',
        text: 'Visible to all.',
        by: 'human:alice',
      });
      const anonMarks = await request(base, 'GET', `/documents/${plainSlug}/bridge/marks`);
      assertEqual(markAuthors(anonMarks.json.marks).join(','), 'human:alice');
      const doc = await request(base, 'GET', `/api/documents/${plainSlug}`);
      assertEqual(doc.json.blindMode, false);

      const reveal = await request(base, 'POST', `/api/documents/${plainSlug}/reveal`, {}, {
        'x-share-token': plain.json.ownerSecret as string,
      });
      assertEqual(reveal.status, 409, 'reveal on a non-blind doc should 409');
    });
  });
}

async function run(): Promise<void> {
  console.log('\n=== Blind review mode test suite ===');
  await runBlindModeTests();
}

run()
  .then(() => {
    console.log('\n=== Blind review mode test results ===');
    console.log(`Passed: ${passed}, Failed: ${failed}`);
    if (failed > 0) process.exit(1);
  })
  .catch((err) => {
    console.error('Test harness error:', err);
    process.exit(1);
  });
