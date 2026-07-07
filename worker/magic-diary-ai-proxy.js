const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

function normalizeOpenAIBaseUrl(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/, '').replace(/\/v1$/, '');
}

async function readJson(request) {
  const raw = await request.text();
  return raw ? JSON.parse(raw) : {};
}

function withCors(response, stream = false) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
  if (stream) {
    headers.set('Cache-Control', 'no-cache, no-transform');
    if (!headers.get('Content-Type')) headers.set('Content-Type', 'text/event-stream; charset=utf-8');
    headers.set('X-Accel-Buffering', 'no');
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function handleModels(request) {
  if (request.method !== 'POST') return json(405, { error: '只支持 POST。' });
  const { baseUrl, apiKey } = await readJson(request);
  if (!baseUrl || !apiKey) return json(400, { error: '缺少接口地址或 API Key。' });
  const upstream = await fetch(`${normalizeOpenAIBaseUrl(baseUrl)}/v1/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  return withCors(upstream);
}

async function handleChat(request, stream) {
  if (request.method !== 'POST') return json(405, { error: '只支持 POST。' });
  const { baseUrl, apiKey, payload } = await readJson(request);
  if (!baseUrl || !apiKey || !payload) return json(400, { error: '缺少接口地址、API Key 或请求体。' });
  const upstream = await fetch(`${normalizeOpenAIBaseUrl(baseUrl)}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(stream ? { ...payload, stream: true } : payload),
  });
  return withCors(upstream, stream);
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/ai-proxy/models') return await handleModels(request);
      if (url.pathname === '/api/ai-proxy/chat-stream') return await handleChat(request, true);
      if (url.pathname === '/api/ai-proxy/chat') return await handleChat(request, false);
      if (url.pathname.endsWith('/models')) return await handleModels(request);
      if (url.pathname.endsWith('/chat-stream')) return await handleChat(request, true);
      if (url.pathname.endsWith('/chat')) return await handleChat(request, false);
      if (env && env.ASSETS) return env.ASSETS.fetch(request);
      return json(404, { error: '静态资源绑定不可用。' });
    } catch (error) {
      return json(500, { error: error instanceof Error ? error.message : String(error) });
    }
  },
};
