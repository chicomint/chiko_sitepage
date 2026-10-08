import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, copyFile, mkdtemp, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

test('server starts and serves pages when optional public folders have been deleted', async () => {
  const source = fileURLToPath(new URL('..', import.meta.url));
  const folder = await mkdtemp(join(tmpdir(), 'chiko-no-public-folders-'));
  let app;
  try {
    // Isolate the actual server code with no d, math, media or picture directory.
    for (const entry of await readdir(source, { withFileTypes: true })) {
      if (entry.isFile() && /\.(js|html|css)$/.test(entry.name) || entry.name === 'package.json') await copyFile(join(source, entry.name), join(folder, entry.name));
    }
    await cp(join(source, 'cms'), join(folder, 'cms'), { recursive: true });
    await symlink(join(source, 'node_modules'), join(folder, 'node_modules'), 'dir');
    const { createPresenceServer } = await import(pathToFileURL(join(folder, 'server.js')).href);
    app = createPresenceServer({ statsCsvPath: null, drawingsDirectory: join(folder, 'data', 'drawings') });
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + app.server.address().port;
    assert.equal(await (await fetch(origin + '/health')).text(), 'ok');
    for (const path of ['/', '/drawings', '/comments.js']) assert.equal((await fetch(origin + path)).status, 200, path);
    for (const path of ['/d/', '/math/', '/media/missing.png', '/picture/missing.jpg', '/server.js', '/package.json']) assert.equal((await fetch(origin + path)).status, 404, path);
    assert.ok(!(await readdir(folder)).includes('d'), 'Startup does not recreate the deleted folder');
  } finally { await app?.close(); await rm(folder, { recursive: true, force: true }); }
});
