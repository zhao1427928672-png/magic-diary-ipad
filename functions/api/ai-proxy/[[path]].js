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

function withCors(response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
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
  return withCors(upstream);
}

export async function onRequest(context) {
  const { request, params } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  const path = Array.isArray(params.path) ? params.path.join('/') : String(params.path || '');
  try {
    if (path === 'models') return await handleModels(request);
    if (path === 'chat-stream') return await handleChat(request, true);
    if (path === 'chat') return await handleChat(request, false);
    return json(404, { error: '未知接口。' });
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : String(error) });
  }
}
