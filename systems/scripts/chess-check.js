import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createPresenceServer } from '../server.js';

const folder = await mkdtemp(join(tmpdir(), 'chiko-chess-'));
const app = createPresenceServer({ statsCsvPath: null, drawingsDirectory: join(folder, 'drawings') });
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + app.server.address().port;
const browser = await chromium.launch({ headless: true });
const checks = [], errors = [];
const artifacts = new URL('../artifacts/chess/', import.meta.url);
await mkdir(artifacts, { recursive: true });
const frame = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function open({ fen, mobile = false, fallback = false } = {}) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  await context.route('https://**/*', route => route.fulfill({ status: 200, body: '', contentType: route.request().resourceType() === 'stylesheet' ? 'text/css' : 'text/plain' }));
  if (fen) {
    const rules = await readFile(new URL('../../media/chess/vendor/chess.js/chess.js', import.meta.url), 'utf8');
    await context.route('**/media/chess/vendor/chess.js/chess.js', route => route.fulfill({ contentType: 'text/javascript', body: rules + `\n{
      const OriginalChess = window.ChikoChessRules.Chess;
      window.ChikoChessRules.Chess = class extends OriginalChess {
        constructor() { super(${JSON.stringify(fen)}); }
        reset() { this.load(${JSON.stringify(fen)}); }
      };
    }` }));
  }
  await context.addInitScript(fallback => {
    window.chessCommands = [];
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (command, ...args) {
      window.chessCommands.push(command);
      return post.call(this, command, ...args);
    };
    if (fallback) window.WebAssembly = undefined;
  }, fallback);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin, { waitUntil: 'load' });
  await page.locator('#chess-enlarge').click();
  await humanTurn(page);
  return { context, page };
}

async function point(page, key) {
  const board = page.locator('cg-board');
  await board.scrollIntoViewIfNeeded();
  await frame(page);
  const rect = await board.boundingBox();
  const black = await page.locator('#chess-board').evaluate(element => element.classList.contains('orientation-black'));
  const file = key.charCodeAt(0) - 97, rank = Number(key[1]) - 1;
  return { x: rect.x + (black ? 7.5 - file : file + .5) * rect.width / 8, y: rect.y + (black ? rank + .5 : 7.5 - rank) * rect.height / 8 };
}
async function click(page, key) { const p = await point(page, key); await page.mouse.click(p.x, p.y); await frame(page); }
async function move(page, from, to) { await click(page, from); await click(page, to); await frame(page); }
async function humanTurn(page) {
  await page.waitForFunction(() => document.querySelector('#chess-board').getAttribute('aria-busy') === 'false');
  await frame(page);
}
async function piece(page, key) {
  const p = await point(page, key);
  return page.locator('cg-board piece').evaluateAll((pieces, p) => pieces.find(piece => {
    const r = piece.getBoundingClientRect();
    return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom && !piece.classList.contains('fading');
  })?.className || '', p);
}

try {
  for (const [path, type] of [['stockfish.wasm', 'application/wasm'], ['source.tar.gz', 'application/gzip']]) {
    const response = await fetch(origin + '/media/chess/vendor/stockfish/' + path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), type);
  }
  for (const mobile of [false, true]) {
    const { context, page } = await open({ mobile });
    assert.equal(await page.locator('cg-board piece').count(), 32);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.ok(await page.locator('.snowy_banner').evaluate(el => getComputedStyle(el).backgroundImage.includes('/media/fog.jpg')));
    assert.ok(await page.evaluate(() => document.querySelector('#vocaring').compareDocumentPosition(document.querySelector('.chess-corner')) & Node.DOCUMENT_POSITION_FOLLOWING));
    await page.locator('#chess-board').focus();
    await page.keyboard.press('Enter');
    await frame(page);
    assert.equal(await page.locator('square.move-dest').count(), 2);
    await page.keyboard.press('ArrowUp');
    assert.match(await page.locator('#chess-board').getAttribute('aria-label'), /e3/);
    await page.keyboard.press('Escape');
    await move(page, 'e2', 'e5');
    assert.match(await piece(page, 'e2'), /white pawn/);
    await move(page, 'e2', 'e4');
    await humanTurn(page);
    assert.match(await piece(page, 'e4'), /white pawn/);
    assert.equal(await page.locator('square.last-move').count(), 2);
    await page.locator('.chess-corner').screenshot({ path: new URL(mobile ? 'mobile.png' : 'desktop.png', artifacts).pathname });
    await page.locator('#chess-shrink').click();
    await frame(page);
    assert.ok((await page.locator('cg-board').boundingBox()).width <= 256);
    await page.locator('#chess-enlarge').click();
    await frame(page);
    assert.match(await piece(page, 'e4'), /white pawn/);
    await context.close();
    checks.push(`${mobile ? 'mobile' : 'desktop'}: real Chessground, legal moves, keyboard, engine reply, resizing without reset`);
  }
  {
    const { context, page } = await open();
    for (const [level, skill] of [['gentle', 0], ['easy', 3], ['medium', 8], ['hard', 14], ['expert', 20]]) {
      await page.locator('#chess-difficulty').selectOption(level);
      await page.locator('#chess-color').selectOption('b');
      await humanTurn(page);
      assert.match(await page.locator('#chess-status').textContent(), /playing Black/);
      assert.ok(await page.locator('#chess-board').evaluate(el => el.classList.contains('orientation-black')));
      assert.ok(await page.evaluate(skill => window.chessCommands.includes('setoption name Skill Level value ' + skill), skill));
      await page.locator('#chess-color').selectOption('w');
      await humanTurn(page);
    }
    const from = await point(page, 'g1'), to = await point(page, 'f3');
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 }); await page.mouse.up();
    await frame(page); await humanTurn(page);
    assert.match(await piece(page, 'f3'), /white knight/);
    await context.close();
    checks.push('five Stockfish skill levels, Black opening, and drag-and-drop');
  }
  for (const [name, fen, from, to, verify] of [
    ['castling', 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1', 'g1', async page => {
      assert.match(await piece(page, 'g1'), /white king/); assert.match(await piece(page, 'f1'), /white rook/);
    }],
    ['en passant', '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2', 'e5', 'd6', async page => {
      assert.equal(await piece(page, 'd5'), ''); assert.match(await piece(page, 'd6'), /white pawn/);
    }],
    ['promotion', '7k/P7/8/8/8/8/8/4K3 w - - 0 1', 'a7', 'a8', async page => {
      assert.ok(await page.locator('#chess-promotion').isVisible());
      await page.locator('[data-promotion="n"]').click(); await frame(page);
      assert.match(await piece(page, 'a8'), /white knight/);
      assert.match(await page.locator('#chess-status').textContent(), /not enough material/);
    }],
    ['checkmate', '7k/5Q2/6K1/8/8/8/8/8 w - - 0 1', 'f7', 'g7', async page => {
      assert.match(await page.locator('#chess-status').textContent(), /Checkmate — you win/);
      assert.ok(await page.locator('#chess-start').isVisible());
    }],
  ]) {
    const { context, page } = await open({ fen });
    await move(page, from, to); await verify(page); await context.close(); checks.push(name);
  }
  {
    const { context, page } = await open({ fallback: true });
    await move(page, 'e2', 'e4'); await humanTurn(page);
    assert.equal(await page.locator('square.last-move').count(), 2);
    await context.close(); checks.push('JavaScript engine fallback');
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks }, null, 2));
} finally { await browser.close(); await app.close(); await rm(folder, { recursive: true, force: true }); }
