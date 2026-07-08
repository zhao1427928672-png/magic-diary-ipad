export type DiagnosticEvent = {
  at: string;
  kind: string;
  detail: string;
};

export type DiagnosticError = {
  at: string;
  message: string;
};

export type DiagnosticsState = {
  enabled: boolean;
  events: DiagnosticEvent[];
  lastError: DiagnosticError | null;
};

export const DIAGNOSTICS_KEY = 'magic-diary-diagnostics-v1';
const EVENTS_LIMIT = 60;

function parseState(raw: string | null): DiagnosticsState {
  if (!raw) return { enabled: false, events: [], lastError: null };
  try {
    const data = JSON.parse(raw);
    return {
      enabled: Boolean(data?.enabled),
      events: Array.isArray(data?.events) ? data.events.filter((item: any) => item && typeof item.kind === 'string' && typeof item.detail === 'string' && typeof item.at === 'string').slice(-EVENTS_LIMIT) : [],
      lastError: data?.lastError && typeof data.lastError.message === 'string' && typeof data.lastError.at === 'string' ? data.lastError : null,
    };
  } catch {
    return { enabled: false, events: [], lastError: null };
  }
}

function saveState(state: DiagnosticsState) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(DIAGNOSTICS_KEY, JSON.stringify({ ...state, events: state.events.slice(-EVENTS_LIMIT) }));
}

export function loadDiagnostics(): DiagnosticsState {
  if (typeof localStorage === 'undefined') return { enabled: false, events: [], lastError: null };
  return parseState(localStorage.getItem(DIAGNOSTICS_KEY));
}

export function setDiagnosticsEnabled(enabled: boolean) {
  const state = loadDiagnostics();
  saveState({ ...state, enabled });
}

export function pushDiagnosticEvent(event: Omit<DiagnosticEvent, 'at'> & Partial<Pick<DiagnosticEvent, 'at'>>) {
  const state = loadDiagnostics();
  const next: DiagnosticEvent = { at: event.at || new Date().toISOString(), kind: event.kind, detail: event.detail };
  saveState({ ...state, events: [...state.events, next] });
}

export function setLastDiagnosticError(message: string, at = new Date().toISOString()) {
  const state = loadDiagnostics();
  saveState({ ...state, lastError: { at, message } });
}

export function clearDiagnostics() {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(DIAGNOSTICS_KEY);
}
