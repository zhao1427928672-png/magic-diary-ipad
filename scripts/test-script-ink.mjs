import { createRequire } from 'module';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const moduleUrl = new URL('../src/scriptInk.ts', import.meta.url).href;
let mod;
try {
  mod = await import(moduleUrl);
} catch (error) {
  console.error('expected import to fail before implementation:', error.message);
  process.exit(1);
}

const mask = {
  width: 7,
  height: 7,
  pixels: Array.from({ length: 49 }, (_, i) => {
    const x = i % 7;
    const y = Math.floor(i / 7);
    return x === 3 || y === 3;
  }),
};
const thinned = mod.thinMask(mask);
const strokes = mod.traceMask(thinned);
assert(strokes.length >= 2, `expected at least two traced strokes, got ${strokes.length}`);
assert(strokes.every((stroke) => stroke.length >= 2), 'every stroke should have at least two points');
console.log('script-ink tests passed', { strokes: strokes.length, points: strokes.reduce((sum, stroke) => sum + stroke.length, 0) });
