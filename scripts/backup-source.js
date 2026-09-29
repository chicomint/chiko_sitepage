import { mkdir, writeFile, copyFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const directory = 'backups/pre-cms';
await mkdir(`${directory}/drawings`, { recursive: true });
await mkdir('data/drawings', { recursive: true });
const inventory = [];
for (const name of ['all_blog.html', 'blogs.html', 'blogs_showcase.html', 'drawings.html']) {
  const bytes = await readFile(name); await writeFile(`${directory}/local-${name}`, bytes);
  const response = await fetch('https://chiko.cc/' + name);
  if (response.ok) { const remote = Buffer.from(await response.arrayBuffer()); await writeFile(`${directory}/live-${name}`, remote); inventory.push({ name, localHash: createHash('sha256').update(bytes).digest('hex'), liveHash: createHash('sha256').update(remote).digest('hex') }); }
}
const response = await fetch('https://chiko.cc/api/drawings');
if (!response.ok) throw new Error('Cannot back up live drawings.');
const drawings = await response.json();
await writeFile(`${directory}/drawings.json`, JSON.stringify(drawings, null, 2));
for (const drawing of drawings) {
  if (!/^\d{13}-[a-f0-9]{32}\.png$/.test(drawing.filename)) throw new Error('Unexpected drawing filename.');
  const image = await fetch('https://chiko.cc/drawings/' + drawing.filename);
  if (!image.ok) throw new Error('Drawing download failed.');
  const bytes = Buffer.from(await image.arrayBuffer());
  await writeFile(`${directory}/drawings/${drawing.filename}`, bytes);
  await copyFile(`${directory}/drawings/${drawing.filename}`, `data/drawings/${drawing.filename}`);
}
await writeFile(`${directory}/manifest.json`, JSON.stringify({ drawings: drawings.length, files: inventory, savedAt: new Date() }, null, 2));
console.log(JSON.stringify({ backedUpDrawings: drawings.length, sourceFiles: inventory }));
