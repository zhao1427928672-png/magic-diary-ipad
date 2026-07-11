import assert from 'node:assert/strict';
import { shouldFlushReplyUpdate } from '../src/replyStream.ts';

assert.equal(shouldFlushReplyUpdate('', '一二三四五六七'), false, 'seven characters should keep buffering');
assert.equal(shouldFlushReplyUpdate('', '一二三四五六七八'), true, 'eight characters should start the first ink');
assert.equal(shouldFlushReplyUpdate('', '我明白。'), true, 'completed punctuation should start the first ink early');
assert.equal(shouldFlushReplyUpdate('一二三四五六七八', '一二三四五六七八九十甲乙丙丁戊'), false, 'later updates should also wait for eight new characters');
assert.equal(shouldFlushReplyUpdate('一二三四五六七八', '一二三四五六七八继续。'), true, 'later punctuation should flush immediately');
assert.equal(shouldFlushReplyUpdate('已经显示', '已经显示'), false, 'unchanged text should not redraw');

console.log('reply-stream tests passed');
