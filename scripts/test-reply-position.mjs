import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { rmSync } from 'node:fs';

const outDir = '/tmp/magic-diary-reply-position-test';
rmSync(outDir, { recursive: true, force: true });
execFileSync('npx', ['tsc', '--ignoreConfig', 'src/replyPosition.ts', '--target', 'ES2020', '--module', 'ES2020', '--outDir', outDir, '--skipLibCheck'], { stdio: 'inherit' });
const mod = await import(pathToFileURL(`${outDir}/replyPosition.js`).href);
const { computeReplyPosition } = mod;

const base = { canvasW: 768, canvasH: 1024, replyW: 520, replyH: 160, safeTop: 56, safeBottom: 92, margin: 36 };

assert.deepEqual(
  computeReplyPosition({ ...base, mode: 'fixed-center', inputBox: { x: 80, y: 700, w: 300, h: 120 } }),
  { x: 124, y: 414 },
  'fixed-center should ignore input bbox and use safe visual center'
);

assert.equal(
  computeReplyPosition({ ...base, mode: 'follow-writing', inputBox: { x: 100, y: 180, w: 260, h: 80 } }).y,
  180,
  'follow-writing should start at the top of the first handwritten character'
);

assert.equal(
  computeReplyPosition({ ...base, mode: 'follow-writing', inputBox: { x: 100, y: 180, w: 260, h: 80 } }).x,
  100,
  'follow-writing should start at the left edge of the first handwritten character'
);

assert.equal(
  computeReplyPosition({ ...base, mode: 'auto', inputBox: { x: 100, y: 820, w: 260, h: 90 } }).y,
  636,
  'auto should place reply above the writing if bottom space is not enough'
);

assert.equal(
  computeReplyPosition({ ...base, mode: 'auto', inputBox: { x: 120, y: 450, w: 260, h: 80 }, replyH: 520 }).y,
  234,
  'auto should fall back to safe center if neither above nor below fits'
);

console.log('reply-position tests passed');
