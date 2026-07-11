import assert from 'node:assert/strict';
import { availableModels, builtinProvider, coolDownModel, issueSession, modelCooldowns, verifySession, safeRelayBaseUrl } from '../worker/magic-diary-ai-proxy.js';

assert.equal(safeRelayBaseUrl('http://api.example.com'), null, 'relay should reject plaintext HTTP');
assert.equal(safeRelayBaseUrl('https://localhost:3000'), null, 'relay should reject localhost');
assert.equal(safeRelayBaseUrl('https://192.168.1.2/v1'), null, 'relay should reject private IPv4 targets');
assert.equal(safeRelayBaseUrl('https://api.example.com/v1'), 'https://api.example.com', 'relay should accept public HTTPS and normalize /v1');

const provider = builtinProvider({
  BUILTIN_API_BASE: 'https://api.example.com/v1',
  BUILTIN_API_KEY: 'secret',
  BUILTIN_REPLY_MODEL: ' primary/model, backup/model ',
}, 'reply');
assert.deepEqual(provider?.models, ['primary/model', 'backup/model'], 'built-in providers should preserve fallback priority');
modelCooldowns.clear();
coolDownModel('primary/model', { status: 429, headers: new Headers({ 'Retry-After': '75' }) }, 1000);
assert.deepEqual(availableModels(['primary/model', 'backup/model'], 2000), ['backup/model'], 'rate-limited models should be bypassed');
assert.deepEqual(availableModels(['primary/model', 'backup/model'], 77000), ['primary/model', 'backup/model'], 'models should re-enter after cooldown');

const token = await issueSession('invite-subject', 'test-signing-secret');
assert.equal(await verifySession(token, 'test-signing-secret'), 'invite-subject', 'valid signed sessions should verify');
assert.equal(await verifySession(token, 'wrong-secret'), null, 'sessions signed by another secret should fail');
const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
assert.equal(await verifySession(tampered, 'test-signing-secret'), null, 'tampered sessions should fail');

console.log('worker-security tests passed');
