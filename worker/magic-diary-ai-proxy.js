const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

const DEFAULT_DAILY_QUOTA = 300;
const SESSION_DAYS = 30;
const modelCooldowns = new Map();

function json(status, data, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, ...extraHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function normalizeOpenAIBaseUrl(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/, '').replace(/\/v1$/, '');
}

async function readJson(request, maxBytes = 2_000_000) {
  const raw = await request.text();
  if (raw.length > maxBytes) throw new Error('request_too_large');
  return raw ? JSON.parse(raw) : {};
}

function withCors(response, stream = false) {
  const headers = new Headers();
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Cache-Control', stream ? 'no-cache, no-transform' : 'no-store');
  headers.set('Content-Type', stream ? 'text/event-stream; charset=utf-8' : (response.headers.get('Content-Type') || 'application/json'));
  if (stream) headers.set('X-Accel-Buffering', 'no');
  return new Response(response.body, { status: response.status, headers });
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}

async function issueSession(subject, secret) {
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({ sub: subject, exp: Date.now() + SESSION_DAYS * 86400000 })));
  return `${payload}.${base64Url(await hmac(secret, payload))}`;
}

async function verifySession(token, secret) {
  if (!token || !secret) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = await hmac(secret, payload);
  const actual = decodeBase64Url(signature);
  if (actual.length !== expected.length) return null;
  let mismatch = 0;
  for (let index = 0; index < actual.length; index += 1) mismatch |= actual[index] ^ expected[index];
  if (mismatch !== 0) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload)));
    return data.exp > Date.now() && typeof data.sub === 'string' ? data.sub : null;
  } catch {
    return null;
  }
}

async function subjectForInvite(inviteCode) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(inviteCode)));
  return base64Url(digest).slice(0, 20);
}

async function validateTurnstile(token, request, env) {
  if (!env.TURNSTILE_SECRET_KEY) return true;
  if (!token) return false;
  const form = new FormData();
  form.set('secret', env.TURNSTILE_SECRET_KEY);
  form.set('response', token);
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) form.set('remoteip', ip);
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  const result = await response.json();
  return result.success === true;
}

function configuredInvites(env) {
  return String(env.MAGIC_DIARY_INVITE_CODES || '').split(',').map((code) => code.trim()).filter(Boolean);
}

async function createSession(request, env) {
  if (!env.SESSION_SIGNING_KEY || !env.MAGIC_DIARY_KV) return json(503, { error: 'builtin_not_configured' });
  const { inviteCode, turnstileToken } = await readJson(request, 20_000);
  const invite = String(inviteCode || '').trim();
  if (!invite || !configuredInvites(env).includes(invite)) return json(403, { error: 'invalid_invite' });
  if (!await validateTurnstile(turnstileToken, request, env)) return json(403, { error: 'human_check_failed' });
  const subject = await subjectForInvite(invite);
  return json(200, {
    token: await issueSession(subject, env.SESSION_SIGNING_KEY),
    dailyQuota: Number(env.BUILTIN_DAILY_QUOTA) || DEFAULT_DAILY_QUOTA,
    replyVisionCapability: String(env.BUILTIN_REPLY_SUPPORTS_VISION || 'true') === 'false' ? 'unsupported' : 'supported',
  });
}

function bearerToken(request) {
  const value = request.headers.get('Authorization') || '';
  return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
}

function quotaDate() {
  return new Date().toISOString().slice(0, 10);
}

async function loadQuota(env, subject) {
  const key = `quota:${subject}:${quotaDate()}`;
  const stored = await env.MAGIC_DIARY_KV.get(key, 'json');
  return { key, state: stored && typeof stored === 'object' ? stored : { count: 0, turns: [], rereads: {} } };
}

async function quotaStatus(request, env) {
  const subject = await verifySession(bearerToken(request), env.SESSION_SIGNING_KEY);
  if (!subject) return json(401, { error: 'invalid_session' });
  const { state } = await loadQuota(env, subject);
  const dailyQuota = Number(env.BUILTIN_DAILY_QUOTA) || DEFAULT_DAILY_QUOTA;
  return json(200, { dailyQuota, used: Number(state.count) || 0, remaining: Math.max(0, dailyQuota - (Number(state.count) || 0)) });
}

async function authorizeTurn(request, env, body) {
  const subject = await verifySession(bearerToken(request), env.SESSION_SIGNING_KEY);
  if (!subject) return { response: json(401, { error: 'invalid_session' }) };
  const turnId = String(body.turnId || '');
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(turnId)) return { response: json(400, { error: 'invalid_turn' }) };
  const kind = body.kind === 'reread' ? 'reread' : 'new';
  const quota = await loadQuota(env, subject);
  const dailyQuota = Number(env.BUILTIN_DAILY_QUOTA) || DEFAULT_DAILY_QUOTA;
  const used = Number(quota.state.count) || 0;
  if (kind === 'new' && !quota.state.turns.includes(turnId) && used >= dailyQuota) return { response: json(429, { error: 'daily_quota_reached', remaining: 0 }) };
  const rereads = Number(quota.state.rereads?.[turnId]) || 0;
  if (kind === 'reread' && rereads >= 3) return { response: json(429, { error: 'reread_limit_reached' }) };
  return { subject, turnId, kind, quota, dailyQuota };
}

async function recordSuccessfulTurn(env, auth) {
  const state = auth.quota.state;
  state.turns = Array.isArray(state.turns) ? state.turns.slice(-399) : [];
  state.rereads = state.rereads && typeof state.rereads === 'object' ? state.rereads : {};
  if (auth.kind === 'new' && !state.turns.includes(auth.turnId)) {
    state.turns.push(auth.turnId);
    state.count = (Number(state.count) || 0) + 1;
  } else if (auth.kind === 'reread') {
    state.rereads[auth.turnId] = (Number(state.rereads[auth.turnId]) || 0) + 1;
  }
  await env.MAGIC_DIARY_KV.put(auth.quota.key, JSON.stringify(state), { expirationTtl: 3 * 86400 });
}

function builtinProvider(env, route) {
  const baseUrl = normalizeOpenAIBaseUrl(env.BUILTIN_API_BASE);
  const rawModels = route === 'recognize' ? env.BUILTIN_VISION_MODEL : env.BUILTIN_REPLY_MODEL;
  const models = String(rawModels || '').split(',').map((model) => model.trim()).filter(Boolean);
  if (!baseUrl || !env.BUILTIN_API_KEY || models.length === 0) return null;
  return { baseUrl, apiKey: env.BUILTIN_API_KEY, models };
}

function availableModels(models, now = Date.now()) {
  return models.filter((model) => (modelCooldowns.get(model) || 0) <= now);
}

function coolDownModel(model, response, now = Date.now()) {
  const retryAfterSeconds = Number(response?.headers?.get('Retry-After'));
  const fallbackMs = response?.status === 429 ? 90000 : 60000;
  const durationMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
    ? Math.min(120000, Math.max(15000, retryAfterSeconds * 1000))
    : fallbackMs;
  modelCooldowns.set(model, now + durationMs);
}

async function handleBuiltinChat(request, env, ctx, stream) {
  if (!env.MAGIC_DIARY_KV) return json(503, { error: 'builtin_not_configured' });
  const body = await readJson(request);
  const auth = await authorizeTurn(request, env, body);
  if (auth.response) return auth.response;
  const route = body.route === 'recognize' ? 'recognize' : 'reply';
  const provider = builtinProvider(env, route);
  if (!provider) return json(503, { error: 'builtin_not_configured' });
  const incoming = body.payload && typeof body.payload === 'object' ? body.payload : {};
  if (!Array.isArray(incoming.messages)) return json(400, { error: 'invalid_messages' });
  const payload = {
    messages: incoming.messages,
    temperature: Math.max(0, Math.min(1.5, Number(incoming.temperature) || 0.6)),
    max_tokens: Math.max(80, Math.min(1200, Number(incoming.max_tokens) || 520)),
    ...(stream ? { stream: true } : {}),
  };
  let upstream = null;
  for (const model of availableModels(provider.models)) {
    try {
      const candidate = await fetch(`${provider.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
        body: JSON.stringify({ ...payload, model }),
        signal: AbortSignal.timeout(4000),
      });
      if (candidate.ok) {
        upstream = candidate;
        break;
      }
      // Invalid requests are payload problems; switching models would only add delay.
      if (![404, 408, 409, 429].includes(candidate.status) && candidate.status < 500) {
        return json(400, { error: 'builtin_request_failed' });
      }
      coolDownModel(model, candidate);
    } catch {
      coolDownModel(model, null);
    }
  }
  if (!upstream) return json(502, { error: 'builtin_models_unavailable' });
  // Recognition is an implementation detail. Charge only after the reply succeeds.
  if (route === 'reply') ctx.waitUntil(recordSuccessfulTurn(env, auth));
  const shouldCharge = route === 'reply' && auth.kind === 'new' && !auth.quota.state.turns.includes(auth.turnId);
  const remaining = Math.max(0, auth.dailyQuota - ((Number(auth.quota.state.count) || 0) + (shouldCharge ? 1 : 0)));
  const response = withCors(upstream, stream);
  response.headers.set('X-Diary-Quota-Remaining', String(remaining));
  return response;
}

function safeRelayBaseUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local') || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return null;
    return normalizeOpenAIBaseUrl(url.toString());
  } catch {
    return null;
  }
}

export { issueSession, verifySession, safeRelayBaseUrl, builtinProvider, availableModels, coolDownModel, modelCooldowns };

async function handleModels(request) {
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const { baseUrl, apiKey } = await readJson(request);
  const safeBase = safeRelayBaseUrl(baseUrl);
  if (!safeBase || !apiKey) return json(400, { error: 'invalid_relay_config' });
  const upstream = await fetch(`${safeBase}/v1/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
  return withCors(upstream);
}

async function handleRelayChat(request, stream) {
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const { baseUrl, apiKey, payload } = await readJson(request);
  const safeBase = safeRelayBaseUrl(baseUrl);
  if (!safeBase || !apiKey || !payload || !Array.isArray(payload.messages)) return json(400, { error: 'invalid_relay_config' });
  const safePayload = { ...payload, max_tokens: Math.max(80, Math.min(4000, Number(payload.max_tokens) || 520)), ...(stream ? { stream: true } : {}) };
  const upstream = await fetch(`${safeBase}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(safePayload),
  });
  return withCors(upstream, stream);
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    const url = new URL(request.url);
    try {
      if (url.pathname.endsWith('/builtin/session') && request.method === 'POST') return await createSession(request, env);
      if (url.pathname.endsWith('/builtin/quota') && request.method === 'GET') return await quotaStatus(request, env);
      if (url.pathname.endsWith('/builtin/chat-stream') && request.method === 'POST') return await handleBuiltinChat(request, env, ctx, true);
      if (url.pathname.endsWith('/builtin/chat') && request.method === 'POST') return await handleBuiltinChat(request, env, ctx, false);
      if (url.pathname.endsWith('/models')) return await handleModels(request);
      if (url.pathname.endsWith('/chat-stream')) return await handleRelayChat(request, true);
      if (url.pathname.endsWith('/chat')) return await handleRelayChat(request, false);
      if (env?.ASSETS) return env.ASSETS.fetch(request);
      return json(404, { error: 'not_found' });
    } catch (error) {
      const code = error instanceof Error && error.message === 'request_too_large' ? 413 : 500;
      return json(code, { error: code === 413 ? 'request_too_large' : 'internal_error' });
    }
  },
};
