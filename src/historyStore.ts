export type HistoryEntry = {
  id: string;
  at: string;
  inputText?: string;
  reply: string;
  model?: string;
  persona?: string;
  replyLength?: string;
};

export const HISTORY_KEY = 'magic-diary-history-v1';
const HISTORY_LIMIT = 50;

function safeParseHistory(raw: string | null): HistoryEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is HistoryEntry => Boolean(item && typeof item === 'object' && typeof item.reply === 'string'));
  } catch {
    return [];
  }
}

export function loadHistory(): HistoryEntry[] {
  if (typeof localStorage === 'undefined') return [];
  return safeParseHistory(localStorage.getItem(HISTORY_KEY));
}

export function saveHistory(entries: HistoryEntry[]) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(-HISTORY_LIMIT)));
}

export function addHistoryEntry(entry: Omit<HistoryEntry, 'id' | 'at'> & Partial<Pick<HistoryEntry, 'id' | 'at'>>) {
  const current = loadHistory();
  const next: HistoryEntry = {
    id: entry.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: entry.at || new Date().toISOString(),
    inputText: entry.inputText,
    reply: entry.reply,
    model: entry.model,
    persona: entry.persona,
    replyLength: entry.replyLength,
  };
  saveHistory([...current, next]);
  return next;
}

export function clearHistory() {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(HISTORY_KEY);
}
