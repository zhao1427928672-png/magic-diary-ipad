export type HistoryEntry = {
  id: string;
  at: string;
  inputText?: string;
  reply: string;
  model?: string;
  persona?: string;
  replyLength?: string;
  threadId?: string;
};

export const HISTORY_KEY = 'magic-diary-history-v1';
export const HISTORY_THREAD_KEY = 'magic-diary-history-thread-v1';
const HISTORY_LIMIT = 50;
const MAX_INPUT_CHARS = 1200;
const MAX_REPLY_CHARS = 2400;

function trimText(value: unknown, max: number) {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function normalizeEntry(item: unknown): HistoryEntry | null {
  if (!item || typeof item !== 'object') return null;
  const data = item as Record<string, unknown>;
  const reply = trimText(data.reply, MAX_REPLY_CHARS);
  if (!reply) return null;
  const at = typeof data.at === 'string' && !Number.isNaN(Date.parse(data.at)) ? data.at : new Date().toISOString();
  const id = typeof data.id === 'string' && data.id ? data.id : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    at,
    inputText: trimText(data.inputText, MAX_INPUT_CHARS),
    reply,
    model: trimText(data.model, 120),
    persona: trimText(data.persona, 80),
    replyLength: trimText(data.replyLength, 40),
    threadId: trimText(data.threadId, 80),
  };
}

function safeParseHistory(raw: string | null): HistoryEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeEntry).filter((item): item is HistoryEntry => Boolean(item));
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

export function loadActiveThreadId() {
  if (typeof localStorage === 'undefined') return 'default';
  const raw = localStorage.getItem(HISTORY_THREAD_KEY);
  return trimText(raw, 80) || 'default';
}

export function setActiveThreadId(threadId: string) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(HISTORY_THREAD_KEY, trimText(threadId, 80) || 'default');
}

export function createNewThreadId() {
  return `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function addHistoryEntry(entry: Omit<HistoryEntry, 'id' | 'at'> & Partial<Pick<HistoryEntry, 'id' | 'at'>>) {
  const current = loadHistory();
  const next = normalizeEntry({
    id: entry.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: entry.at || new Date().toISOString(),
    inputText: entry.inputText,
    reply: entry.reply,
    model: entry.model,
    persona: entry.persona,
    replyLength: entry.replyLength,
    threadId: entry.threadId,
  });
  if (!next) throw new Error('历史记录缺少回信内容。');
  saveHistory([...current, next]);
  return next;
}

export function clearHistory() {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(HISTORY_KEY);
}
