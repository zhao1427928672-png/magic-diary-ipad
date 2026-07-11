import assert from 'node:assert/strict';
import { scoreScratchGesture } from '../src/scratchGesture.ts';

const target = { x: 100, y: 100, w: 300, h: 80 };
const scale = 0.25;
const width = 200;
const height = 100;
const alpha = new Uint8Array(width * height);
for (let y = 27; y <= 42; y += 1) {
  for (let x = 27; x <= 99; x += 1) alpha[y * width + x] = 255;
}
const mask = { scale, width, height, alpha };

function stroke(coords, start = 0) {
  return { points: coords.map(([x, y], index) => ({ x, y, t: start + index * 30 })) };
}

const backAndForth = stroke([[110, 120], [380, 125], [120, 135], [375, 145], [115, 150]]);
assert.equal(scoreScratchGesture([backAndForth], target, mask).recognized, true, 'back-and-forth scratching over reply should delete');

const twoLines = [
  stroke([[110, 120], [200, 122], [290, 124], [380, 125]]),
  stroke([[115, 145], [205, 144], [295, 146], [375, 148]], 160),
];
assert.equal(scoreScratchGesture(twoLines, target, mask).recognized, true, 'multiple crossing lines should delete');

const circleAround = stroke([[90, 90], [410, 90], [410, 190], [90, 190], [90, 90]]);
assert.equal(scoreScratchGesture([circleAround], target, mask).recognized, false, 'a circle around text without hitting glyphs should not delete');

const normalWriting = stroke([[130, 115], [138, 150], [145, 120], [152, 155]]);
assert.equal(scoreScratchGesture([normalWriting], target, mask).recognized, false, 'small ordinary writing should not delete');

console.log('scratch-gesture tests passed');
