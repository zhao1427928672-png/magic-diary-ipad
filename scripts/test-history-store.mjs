import { addHistoryEntry, clearHistory, loadHistory } from '../src/historyStore.ts';

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

addHistoryEntry({ inputText: '你好', reply: '你好。', model: 'mock', persona: 'none', replyLength: 'standard' });
let history = loadHistory();
assert(history.length === 1, `expected one entry, got ${history.length}`);
assert(history[0].inputText === '你好', 'input text should be saved');
assert(history[0].reply === '你好。', 'reply should be saved');
assert(history[0].id && history[0].at, 'id and timestamp should be generated');

for (let i = 0; i < 60; i += 1) addHistoryEntry({ inputText: `q${i}`, reply: `a${i}` });
history = loadHistory();
assert(history.length === 50, `history should be capped at 50, got ${history.length}`);
assert(history[0].inputText === 'q10', `oldest entries should be trimmed, got ${history[0].inputText}`);
assert(history.at(-1).inputText === 'q59', 'newest entry should be kept');

clearHistory();
assert(loadHistory().length === 0, 'clear should remove all history');
console.log('history-store tests passed');
