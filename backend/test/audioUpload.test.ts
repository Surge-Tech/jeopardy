import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { EXT_BY_MIME, CONTENT_TYPE_BY_EXT } from '../src/mediaTypes.js';

test('audio uploads retain their content and return audio media with a matching serving type', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'jeopardy-audio-test-'));
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  const { default: mediaRouter } = await import('../src/routes/media.js');
  const app = express();
  app.use('/api/media', mediaRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    for (const [mime, extension] of Object.entries(EXT_BY_MIME).filter(([mime]) => mime.startsWith('audio/'))) {
      const bytes = `audio fixture for ${mime}`;
      const form = new FormData();
      form.append('file', new Blob([bytes], { type: mime }), `clip${extension}`);
      const response = await fetch(`http://127.0.0.1:${address.port}/api/media/upload`, {
        method: 'POST', body: form,
        headers: process.env.HOST_PASSCODE ? { 'X-Host-Passcode': process.env.HOST_PASSCODE } : {},
      });
      assert.equal(response.status, 200);
      const uploaded = await response.json() as { mediaType: string; filename: string; url: string };
      assert.equal(uploaded.mediaType, 'audio');
      assert.equal(path.extname(uploaded.filename), extension);
      assert.equal(uploaded.url, `/media/${uploaded.filename}`);
      assert.equal(await readFile(path.join(dir, 'media', uploaded.filename), 'utf8'), bytes);
      assert.ok(CONTENT_TYPE_BY_EXT[extension].startsWith('audio/'));
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
