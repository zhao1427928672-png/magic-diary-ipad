import worker from '../../../worker/magic-diary-ai-proxy.js';

export async function onRequest(context) {
  return worker.fetch(context.request, context.env, {
    waitUntil: (promise) => context.waitUntil(promise),
  });
}
