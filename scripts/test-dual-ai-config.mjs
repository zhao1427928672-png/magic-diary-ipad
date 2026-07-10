import { readFileSync } from 'node:fs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const source = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

assert(source.includes("primaryEndpointName: '主接入'"), 'should define primary endpoint default name');
assert(source.includes("visionEndpointName: '补充视觉接入'"), 'should define supplemental vision endpoint default name');
assert(source.includes('clean.ai.visionBaseUrl = String(clean.ai.visionBaseUrl || \'\').trim();'), 'should sanitize visionBaseUrl');
assert(source.includes('clean.ai.visionApiKey = String(clean.ai.visionApiKey || \'\').trim();'), 'should sanitize visionApiKey');
assert(source.includes('function visionProviderBaseUrl()'), 'should expose visionProviderBaseUrl helper');
assert(source.includes('function visionProviderApiKey()'), 'should expose visionProviderApiKey helper');
assert(source.includes("settings.ai.modelMode === 'split' ? { baseUrl: visionProviderBaseUrl(), apiKey: visionProviderApiKey() } : undefined"), 'should route OCR through supplemental vision endpoint when split mode is enabled');
assert(source.includes('const [visionModelOptions, setVisionModelOptions] = useState<string[]>([])'), 'should keep a separate vision model list');
assert(source.includes('async function loadVisionModelOptions()'), 'should provide a separate loader for supplemental vision models');
assert(source.includes('options={visionModelOptions}'), 'vision model picker should use vision model options');
assert(source.includes('function saveAiEndpoints()'), 'should support saving endpoint presets');
assert(source.includes('function loadAiEndpoints(nameFromSelect?: string)'), 'should support loading endpoint presets by name');
assert(source.includes("const [aiEndpointPresetNames, setAiEndpointPresetNames] = useState<string[]>([])"), 'should track saved endpoint preset names for selector UI');
assert(source.includes('已保存接入配置'), 'should render saved endpoint preset selector UI');
console.log('dual-ai-config tests passed');
