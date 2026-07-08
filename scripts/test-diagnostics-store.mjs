import { clearDiagnostics, loadDiagnostics, pushDiagnosticEvent, setDiagnosticsEnabled, setLastDiagnosticError } from '../src/diagnosticsStore.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => store.has(key) ? store.get(key) : null,
  setItem: (key, value) => { store.set(key, String(value)); },
  removeItem: (key) => { store.delete(key); },
};

clearDiagnostics();
let diag = loadDiagnostics();
assert(diag.enabled === false, 'diagnostics should default disabled');

setDiagnosticsEnabled(true);
diag = loadDiagnostics();
assert(diag.enabled === true, 'enabled should persist');

pushDiagnosticEvent({ kind: 'capture', detail: 'capture complete' });
pushDiagnosticEvent({ kind: 'reply', detail: 'reply started' });
diag = loadDiagnostics();
assert(diag.events.length === 2, `expected 2 events, got ${diag.events.length}`);
assert(diag.events[0].kind === 'capture', 'first event should be capture');

setLastDiagnosticError('boom');
diag = loadDiagnostics();
assert(diag.lastError?.message === 'boom', 'lastError should be persisted');

for (let i = 0; i < 80; i += 1) pushDiagnosticEvent({ kind: 'tick', detail: `event-${i}` });
diag = loadDiagnostics();
assert(diag.events.length === 60, `events should be capped at 60, got ${diag.events.length}`);
assert(diag.events[0].detail === 'event-20', 'old events should be trimmed');

clearDiagnostics();
diag = loadDiagnostics();
assert(diag.enabled === false, 'clear should reset enabled');
assert(diag.events.length === 0 && diag.lastError === null, 'clear should reset diagnostics');
console.log('diagnostics-store tests passed');
