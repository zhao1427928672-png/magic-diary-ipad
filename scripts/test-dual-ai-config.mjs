import { readFileSync } from 'node:fs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const source = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

assert(source.includes("replyVisionCapability: 'auto'"), 'reply vision capability should default to auto');
assert(source.includes('function loadVisionCapability('), 'should cache detected reply-model vision capability');
assert(source.includes('function saveVisionCapability('), 'should persist detected reply-model vision capability');
assert(source.includes('function isUnsupportedVisionError('), 'should distinguish unsupported images from transient failures');
assert(source.includes("if (!isUnsupportedVisionError(error) || !hasRecognitionRoute) throw error;"), 'should only fall back after a clear unsupported-image error');
assert(source.includes("saveVisionCapability(settings.ai.baseUrl, replyModel, 'supported')"), 'successful direct reading should cache support');
assert(source.includes("saveVisionCapability(settings.ai.baseUrl, replyModel, 'unsupported')"), 'rejected images should cache lack of support');
assert(source.includes('function visionProviderBaseUrl()'), 'should expose the recognition-provider base URL helper');
assert(source.includes('function visionProviderApiKey()'), 'should expose the recognition-provider API key helper');
assert(source.includes('const [visionModelOptions, setVisionModelOptions] = useState<string[]>([])'), 'should keep a separate recognition-model list');
assert(source.includes('canvas.toDataURL(\'image/png\')'), 'handwriting should be sent as lossless PNG');
assert(source.includes('const adaptivePad = Math.round(Math.max(bbox.w, bbox.h) * 0.12)'), 'handwriting crop should use adaptive whitespace');
assert(source.includes("const hasRecognitionRoute = isBuiltinAI() || Boolean(settings.ai.visionModel.trim())"), 'built-in mode should use its server-managed vision route without a local model name');
assert(source.includes("if (!hasRecognitionRoute) throw new Error('回复模型不支持图片，请配置识字模型。')"), 'only custom mode without a recognition model should show the configuration error');
assert(source.includes("strikeTargets: ['user-ink', 'ai-reply']"), 'scratch deletion should be enabled for user ink and AI replies by default');

console.log('automatic model routing tests passed');
