import { addHistoryEntry, clearHistory, loadHistory, loadActiveThreadId, setActiveThreadId, createNewThreadId, replaceHistoryEntry } from '../src/historyStore.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => store.has(key) ? store.get(key) : null,
  setItem: (key, value) => { store.set(key, String(value)); },
  removeItem: (key) => { store.delete(key); },
};

clearHistory();
assert(loadHistory().length === 0, 'history should start empty after clear');
assert(loadActiveThreadId() === 'default', 'default active thread should be default');

setActiveThreadId('thread-a');
assert(loadActiveThreadId() === 'thread-a', 'active thread should persist');
const newThread = createNewThreadId();
assert(newThread.startsWith('thread-'), 'new thread id should use thread- prefix');

addHistoryEntry({ inputText: '你好', reply: '你好。', model: 'mock', persona: 'none', replyLength: 'standard', threadId: 'thread-a' });
let history = loadHistory();
assert(history.length === 1, `expected one entry, got ${history.length}`);
assert(history[0].inputText === '你好', 'input text should be saved');
assert(history[0].reply === '你好。', 'reply should be saved');
assert(history[0].threadId === 'thread-a', 'thread id should be saved');
assert(history[0].id && history[0].at, 'id and timestamp should be generated');
const originalId = history[0].id;
const originalAt = history[0].at;
replaceHistoryEntry(originalId, { reply: '重新读懂了。', model: 'vision-model' });
history = loadHistory();
assert(history[0].reply === '重新读懂了。', 're-read should replace the original reply');
assert(history[0].model === 'vision-model', 're-read should replace model metadata');
assert(history[0].id === originalId && history[0].at === originalAt, 'replacement should preserve identity and timestamp');

for (let i = 0; i < 60; i += 1) addHistoryEntry({ inputText: `q${i}`, reply: `a${i}`, threadId: i % 2 === 0 ? 'thread-a' : 'thread-b' });
history = loadHistory();
assert(history.length === 50, `history should be capped at 50, got ${history.length}`);
assert(history[0].inputText === 'q10', `oldest entries should be trimmed, got ${history[0].inputText}`);
assert(history.at(-1).inputText === 'q59', 'newest entry should be kept');
assert(history.some((entry) => entry.threadId === 'thread-b'), 'mixed thread ids should persist');

addHistoryEntry({ inputText: 'x'.repeat(2000), reply: 'y'.repeat(3000), threadId: 'thread-z' });
history = loadHistory();
assert(history.at(-1).inputText.endsWith('…'), 'long input should be trimmed');
assert(history.at(-1).reply.endsWith('…'), 'long reply should be trimmed');
assert(history.at(-1).threadId === 'thread-z', 'thread id should survive long text normalization');
assert(history.at(-1).inputText.length <= 1201, 'trimmed input should stay bounded');
assert(history.at(-1).reply.length <= 2401, 'trimmed reply should stay bounded');

store.set('magic-diary-history-v1', '{bad json');
assert(loadHistory().length === 0, 'bad JSON should be ignored');
store.set('magic-diary-history-v1', JSON.stringify([{ reply: 123 }, { reply: 'ok', at: 'bad-date', id: '', threadId: 'thread-ok' }]));
history = loadHistory();
assert(history.length === 1 && history[0].reply === 'ok', 'invalid entries should be filtered and valid entries normalized');
assert(history[0].threadId === 'thread-ok', 'thread id should survive safe parsing');
assert(!Number.isNaN(Date.parse(history[0].at)), 'invalid date should be normalized');

clearHistory();
assert(loadHistory().length === 0, 'clear should remove all history');
assert(loadActiveThreadId() === 'thread-a', 'clearHistory should not reset active thread by itself');
console.log('history-store tests passed');
