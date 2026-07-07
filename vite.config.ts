import { defineConfig, type ViteDevServer } from 'vite';

async function readJson(req: any) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res: any, status: number, data: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function normalizeOpenAIBaseUrl(baseUrl: string) {
  return String(baseUrl).replace(/\/$/, '').replace(/\/v1$/, '');
}

function aiProxyPlugin() {
  return {
    name: 'magic-diary-ai-proxy',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api/ai-proxy/models', async (req, res) => {
        try {
          if (req.method !== 'POST') return sendJson(res, 405, { error: '只支持 POST。' });
          const { baseUrl, apiKey } = await readJson(req);
          if (!baseUrl || !apiKey) return sendJson(res, 400, { error: '缺少接口地址或 API Key。' });
          const url = `${normalizeOpenAIBaseUrl(baseUrl)}/v1/models`;
          const upstream = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
          const text = await upstream.text();
          res.statusCode = upstream.status;
          res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
          res.end(text);
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      });

      server.middlewares.use('/api/ai-proxy/chat-stream', async (req, res) => {
        try {
          if (req.method !== 'POST') return sendJson(res, 405, { error: '只支持 POST。' });
          const { baseUrl, apiKey, payload } = await readJson(req);
          if (!baseUrl || !apiKey || !payload) return sendJson(res, 400, { error: '缺少接口地址、API Key 或请求体。' });
          const url = `${normalizeOpenAIBaseUrl(baseUrl)}/v1/chat/completions`;
          const upstream = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ ...payload, stream: true }),
          });
          res.statusCode = upstream.status;
          res.setHeader('Content-Type', upstream.headers.get('content-type') || 'text/event-stream; charset=utf-8');
          if (!upstream.ok || !upstream.body) {
            res.end(await upstream.text());
            return;
          }
          const reader = upstream.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(Buffer.from(value));
          }
          res.end();
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      });

      server.middlewares.use('/api/ai-proxy/chat', async (req, res) => {
        try {
          if (req.method !== 'POST') return sendJson(res, 405, { error: '只支持 POST。' });
          const { baseUrl, apiKey, payload } = await readJson(req);
          if (!baseUrl || !apiKey || !payload) return sendJson(res, 400, { error: '缺少接口地址、API Key 或请求体。' });
          const url = `${normalizeOpenAIBaseUrl(baseUrl)}/v1/chat/completions`;
          const upstream = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify(payload),
          });
          const text = await upstream.text();
          res.statusCode = upstream.status;
          res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
          res.end(text);
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      });
    },
  };
}

export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/magic-diary-ipad/' : '/',
  plugins: [aiProxyPlugin()],
});
