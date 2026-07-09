import React, { Component, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { computeReplyPosition, type ReplyPositionMode } from './replyPosition';
import { addHistoryEntry, clearHistory, loadHistory, loadActiveThreadId, setActiveThreadId, createNewThreadId, type HistoryEntry } from './historyStore';
import { clearDiagnostics, loadDiagnostics, pushDiagnosticEvent, setDiagnosticsEnabled, setLastDiagnosticError, type DiagnosticsState } from './diagnosticsStore';
import { strokesForText, type InkStroke } from './scriptInk';
import './styles.css';

type Point = { x: number; y: number; pressure: number; t: number };
type Stroke = { points: Point[] };
type StrikeCandidate = { bbox: BBox; at: number };
type ReplyLine = { text: string; x: number; y: number; width: number; charEnds?: number[]; canvas?: HTMLCanvasElement; quillStrokes?: InkStroke[]; quillScale?: number; quillChars?: Array<{ offsetX: number; strokes: InkStroke[] }> };
type Phase = 'listening' | 'pending' | 'drinking' | 'thinking' | 'replying' | 'lingering';

type BBox = { x: number; y: number; w: number; h: number };

const MOCK_REPLY = '墨迹已经告诉我了。你不是想要一个立刻响亮的答案，而是想确认这条路能不能走。先把能验证的那一步写下来，别急着把整座城都画完。纸会记住你留下的每一道痕迹，也会慢慢抹去那些不必再背着的念头。';
const ASSET_BASE = import.meta.env.BASE_URL || '/';
const PAPER_TEXTURE_SRC = `${ASSET_BASE}assets/parchment-texture.png`;

const paperTexture = new Image();
paperTexture.src = PAPER_TEXTURE_SRC;
// R6 fix: track load failure so drawPaper can fall back to solid fill
let paperTextureFailed = false;
paperTexture.onerror = () => { paperTextureFailed = true; };


type FontOption = {
  id: string;
  name: string;
  family: string;
};

type Settings = {
  schemaVersion: number;
  ui: {
    expandedSections: Record<string, boolean>;
  };
  ai: {
    enabled: boolean;
    adapter: 'openai-compatible' | 'custom-http';
    baseUrl: string;
    apiKey: string;
    primaryEndpointName: string;
    visionBaseUrl: string;
    visionApiKey: string;
    visionEndpointName: string;
    modelMode: 'single' | 'split';
    recognitionMode: 'vision' | 'scribble-first' | 'scribble-only';
    replyPipeline: 'stable' | 'fast-single';
    model: string;
    visionModel: string;
    replyModel: string;
    temperature: number;
    maxTokens: number;
    timeoutMs: number;
    customEndpoint: string;
    customHeaders: string;
    customBody: string;
    customResponsePath: string;
    visionImage: { padding: number; maxSize: number; background: 'white' | 'transparent' | 'paper'; format: 'image/png' | 'image/webp' };
  };
  font: {
    selectedFontId: string;
    sizePreset: 'small' | 'medium' | 'large' | 'custom';
    fontSizePx: number;
    lineHeight: number;
    inkColor: string;
    inkOpacity: number;
    strokeWidth: number;
    shadowStrength: number;
    maxWidth: number;
  };
  animation: {
    speedPreset: 'slow' | 'standard' | 'fast' | 'custom';
    handwritingFadeMs: number;
    replyFadeInMs: number;
    replyLingerMinMs: number;
    replyLingerMaxMs: number;
    replyLingerPerLineMs: number;
    replyLineFadeMs: number;
    replyLineDelayMs: number;
    wholeFadeLineThreshold: number;
  };
  input: {
    idlePreset: 'fast' | 'standard' | 'slow' | 'custom';
    idleCommitMs: number;
    onWriteDuringReply: 'clear-immediately' | 'fade-out' | 'keep';
    strikeTargets: Array<'user-ink' | 'ai-reply'>;
    allowTouchWriting: boolean;
    touchPressure: number;
    penBaseWidth: number;
  };
  paper: {
    backgroundId: string;
    fit: 'cover' | 'contain' | 'repeat' | 'stretch';
    position: 'center' | 'top' | 'bottom';
    brightness: number;
    contrast: number;
    vignette: number;
  };
  reply: {
    positionMode: ReplyPositionMode;
  };
  persona: {
    presetId: string;
    replyLength: 'very-short' | 'short' | 'standard' | 'detailed';
    replyMode: 'reflective' | 'answer' | 'coach' | 'oracle' | 'companion';
    tone: 'calm' | 'warm' | 'mysterious' | 'direct' | 'encouraging';
    useCustomPrompt: boolean;
    customSystemPrompt: string;
    negativePrompt: string;
  };
};

const SETTINGS_KEY = 'magic-diary-settings-v1';
const PRESETS_KEY = 'magic-diary-presets-v1';
const AI_ENDPOINTS_KEY = 'magic-diary-ai-endpoints-v1';
const MODEL_OPTIONS_KEY = 'magic-diary-model-options-v1';
const REVEAL_DELAY_KEY = 'magic-diary-reveal-delay';
function loadDiagnosticsState() {
  return loadDiagnostics();
}
function modelOptionsCacheKey(baseUrl: string) {
  return `${MODEL_OPTIONS_KEY}:${(baseUrl || '').trim().replace(/\/+$/, '') || 'default'}`;
}

const FONT_OPTIONS: FontOption[] = [
  { id: 'xindi-xiawucha', name: '新蒂下午茶白金版', family: 'DiaryHandwriting, DiaryHandwritingFull' },
  { id: 'xindi-paoti', name: '新蒂泡体', family: 'XinDiPaoTi' },
  { id: 'system-kaiti', name: '系统楷体', family: 'Kaiti SC, STKaiti, serif' },
];

function applyPersonaDefaults(settings: Settings, presetId: string) {
  const d = settings;
  d.persona.presetId = presetId;
  if (presetId === 'quiet-friend') {
    d.persona.replyLength = 'short';
    d.persona.replyMode = 'companion';
    d.persona.tone = 'warm';
    d.ai.replyPipeline = 'stable';
  } else if (presetId === 'calm-mentor') {
    d.persona.replyLength = 'short';
    d.persona.replyMode = 'coach';
    d.persona.tone = 'calm';
    d.ai.replyPipeline = 'stable';
  } else if (presetId === 'cultivation-note') {
    d.persona.replyLength = 'standard';
    d.persona.replyMode = 'reflective';
    d.persona.tone = 'calm';
    d.ai.replyPipeline = 'stable';
  } else if (presetId === 'dream-oracle') {
    d.persona.replyLength = 'short';
    d.persona.replyMode = 'oracle';
    d.persona.tone = 'mysterious';
    d.ai.replyPipeline = 'stable';
  } else if (presetId === 'old-paper-reply') {
    d.persona.replyLength = 'short';
    d.persona.replyMode = 'reflective';
    d.persona.tone = 'mysterious';
    d.ai.replyPipeline = 'stable';
  } else if (presetId === 'riddle-diary') {
    d.persona.replyLength = 'short';
    d.persona.replyMode = 'reflective';
    d.persona.tone = 'mysterious';
    d.ai.replyPipeline = 'stable';
  } else if (presetId === 'none') {
    d.persona.replyLength = 'short';
    d.persona.replyMode = 'answer';
    d.persona.tone = 'direct';
    d.ai.replyPipeline = 'stable';
  }
}

function personaPromptExplanation(settings: Settings) {
  const presetName = settings.persona.presetId === 'none' ? '无人格（直接回答）'
    : settings.persona.presetId === 'quiet-friend' ? '安静朋友'
    : settings.persona.presetId === 'calm-mentor' ? '冷静导师'
    : settings.persona.presetId === 'cultivation-note' ? '修行札记'
    : settings.persona.presetId === 'dream-oracle' ? '梦境占卜'
    : settings.persona.presetId === 'riddle-diary' ? '里德尔式魔法日记'
    : settings.persona.presetId === 'old-paper-reply' ? '旧纸回信'
    : settings.persona.presetId === 'custom' ? '自定义人格'
    : settings.persona.presetId;
  const lengthDesc = settings.persona.replyLength === 'very-short' ? '只回 1 句话'
    : settings.persona.replyLength === 'short' ? '默认 1–3 句话'
    : settings.persona.replyLength === 'standard' ? '默认 3–5 句话'
    : '允许更完整展开';
  const modeDesc = settings.persona.replyMode === 'answer' ? '优先直接回答问题'
    : settings.persona.replyMode === 'coach' ? '偏下一步建议'
    : settings.persona.replyMode === 'oracle' ? '偏象征式回应'
    : settings.persona.replyMode === 'companion' ? '偏陪伴与接住情绪'
    : '偏理解与承接上文';
  const toneDesc = settings.persona.tone === 'warm' ? '温和、有陪伴感'
    : settings.persona.tone === 'calm' ? '平稳、克制'
    : settings.persona.tone === 'mysterious' ? '神秘、收着说'
    : settings.persona.tone === 'direct' ? '直接、不绕'
    : '鼓励、向前推一小步';
  return [
    `当前人格：${presetName}`,
    `回复长度：${lengthDesc}`,
    `回应模式：${modeDesc}`,
    `语气：${toneDesc}`,
    `链路：${settings.ai.replyPipeline === 'stable' ? '稳定两段式（先识别再回应）' : '快速单请求'}`,
    `连续对话：会参考当前线程最近 6 条上下文`,
    `禁止事项：${settings.persona.negativePrompt}`,
  ].join('\n');
}

function cloneSettings<T>(value: T): T {
  if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function createDefaultSettings(): Settings {
  return {
  schemaVersion: 4,
  ui: {
    expandedSections: {
      ai: true,
      persona: true,
      font: true,
      animation: true,
      input: true,
      paper: true,
      reply: true,
      debug: false,
    },
  },
  ai: {
    enabled: false,
    adapter: 'openai-compatible',
    baseUrl: 'https://api.openai.com',
    apiKey: '',
    primaryEndpointName: '主接入',
    visionBaseUrl: '',
    visionApiKey: '',
    visionEndpointName: '补充视觉接入',
    modelMode: 'single',
    recognitionMode: 'vision',
    replyPipeline: 'stable',
    model: 'gpt-4o-mini',
    visionModel: '',
    replyModel: '',
    temperature: 0.6,
    maxTokens: 520,
    timeoutMs: 45000,
    customEndpoint: '',
    customHeaders: '{\n  "Authorization": "Bearer {{apiKey}}",\n  "Content-Type": "application/json"\n}',
    customBody: '',
    customResponsePath: 'choices.0.message.content',
    visionImage: { padding: 32, maxSize: 768, background: 'white', format: 'image/webp' },
  },
  font: {
    selectedFontId: 'xindi-xiawucha',
    sizePreset: 'medium',
    fontSizePx: 24,
    lineHeight: 1.65,
    inkColor: '#1a1208',
    inkOpacity: 1,
    strokeWidth: 2.2,
    shadowStrength: 1.2,
    maxWidth: 720,
  },
  animation: {
    speedPreset: 'slow',
    handwritingFadeMs: 1600,
    replyFadeInMs: 1800,
    replyLingerMinMs: 5000,
    replyLingerMaxMs: 7000,
    replyLingerPerLineMs: 260,
    replyLineFadeMs: 2600,
    replyLineDelayMs: 480,
    wholeFadeLineThreshold: 1,
  },
  input: {
    idlePreset: 'fast',
    idleCommitMs: 900,
    onWriteDuringReply: 'fade-out',
    strikeTargets: [],
    allowTouchWriting: true,
    touchPressure: 0.85,
    penBaseWidth: 1.8,
  },
  paper: {
    backgroundId: 'aged-parchment',
    fit: 'cover',
    position: 'center',
    brightness: 1,
    contrast: 1,
    vignette: 0,
  },
  reply: {
    positionMode: 'auto',
  },
  persona: {
    presetId: 'quiet-friend',
    replyLength: 'short',
    replyMode: 'companion',
    tone: 'warm',
    useCustomPrompt: false,
    customSystemPrompt: '',
    negativePrompt: '不要自称 AI。不要长篇说教。不要使用网络热词。不要编造用户没有写下的事实。不要复读用户原文。不要脱离上下文突然换话题。',
  },
};
}

const DEFAULT_SETTINGS: Settings = createDefaultSettings();

function deepMerge<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== 'object') return base;
  const result: any = Array.isArray(base) ? [...base] : { ...(base as any) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    const current = (base as any)[key];
    if (Array.isArray(value)) result[key] = value;
    else if (current && typeof current === 'object' && value && typeof value === 'object' && !Array.isArray(current)) {
      result[key] = deepMerge(current, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function sanitizeSettings(settings: Settings): Settings {
  const defaults = createDefaultSettings();
  const clean = deepMerge(defaults, settings);
  clean.ui = clean.ui && typeof clean.ui === 'object' ? clean.ui : defaults.ui;
  clean.ai = clean.ai && typeof clean.ai === 'object' ? clean.ai : defaults.ai;
  clean.ai.visionImage = clean.ai.visionImage && typeof clean.ai.visionImage === 'object' ? clean.ai.visionImage : defaults.ai.visionImage;
  clean.font = clean.font && typeof clean.font === 'object' ? clean.font : defaults.font;
  clean.animation = clean.animation && typeof clean.animation === 'object' ? clean.animation : defaults.animation;
  clean.input = clean.input && typeof clean.input === 'object' ? clean.input : defaults.input;
  clean.paper = clean.paper && typeof clean.paper === 'object' ? clean.paper : defaults.paper;
  clean.reply = clean.reply && typeof clean.reply === 'object' ? clean.reply : defaults.reply;
  clean.persona = clean.persona && typeof clean.persona === 'object' ? clean.persona : defaults.persona;
  const oneOf = <T extends string>(value: T, allowed: readonly T[], fallback: T) => allowed.includes(value) ? value : fallback;
  const incomingSchemaVersion = Number((settings as any)?.schemaVersion) || 1;
  if (incomingSchemaVersion < 2) {
    clean.ai.replyPipeline = 'fast-single';
    clean.animation.speedPreset = 'slow';
    clean.input.idlePreset = 'fast';
    clean.input.strikeTargets = [];
    clean.persona.presetId = 'riddle-diary';
    clean.persona.replyLength = 'very-short';
    clean.persona.replyMode = 'oracle';
    clean.persona.tone = 'mysterious';
  }
  if (incomingSchemaVersion < 3) {
    clean.ai.visionImage.padding = 32;
    clean.ai.visionImage.maxSize = 768;
    clean.ai.visionImage.format = 'image/webp';
  }
  if (incomingSchemaVersion < 4) {
    clean.animation.replyLingerMinMs = 5000;
    clean.animation.replyLingerMaxMs = 7000;
    clean.animation.replyLineFadeMs = 1800;
  }
  clean.schemaVersion = 4;
  clean.ai.enabled = Boolean(clean.ai.enabled);
  clean.ai.adapter = oneOf(clean.ai.adapter, ['openai-compatible', 'custom-http'] as const, 'openai-compatible');
  clean.ai.modelMode = oneOf(clean.ai.modelMode, ['single', 'split'] as const, 'single');
  clean.ai.recognitionMode = oneOf(clean.ai.recognitionMode, ['vision', 'scribble-first', 'scribble-only'] as const, 'vision');
  clean.ai.replyPipeline = oneOf(clean.ai.replyPipeline, ['stable', 'fast-single'] as const, 'stable');
  clean.ai.temperature = clamp(Number(clean.ai.temperature) || 0.7, 0, 2);
  clean.ai.maxTokens = clamp(Number(clean.ai.maxTokens) || 360, 80, 4000);
  clean.ai.timeoutMs = clamp(Number(clean.ai.timeoutMs) || 45000, 5000, 120000);
  clean.ai.primaryEndpointName = String(clean.ai.primaryEndpointName || defaults.ai.primaryEndpointName || '主接入').trim() || '主接入';
  clean.ai.visionEndpointName = String(clean.ai.visionEndpointName || defaults.ai.visionEndpointName || '补充视觉接入').trim() || '补充视觉接入';
  clean.ai.visionBaseUrl = String(clean.ai.visionBaseUrl || '').trim();
  clean.ai.visionApiKey = String(clean.ai.visionApiKey || '').trim();
  clean.ai.visionImage.padding = clamp(Number(clean.ai.visionImage.padding) || 32, 0, 160);
  clean.ai.visionImage.maxSize = clamp(Number(clean.ai.visionImage.maxSize) || 768, 256, 2048);
  clean.ai.visionImage.background = oneOf(clean.ai.visionImage.background, ['white', 'transparent', 'paper'] as const, 'white');
  clean.ai.visionImage.format = oneOf(clean.ai.visionImage.format, ['image/png', 'image/webp'] as const, 'image/webp');
  clean.font.selectedFontId = FONT_OPTIONS.some((font) => font.id === clean.font.selectedFontId) ? clean.font.selectedFontId : 'xindi-xiawucha';
  clean.font.sizePreset = oneOf(clean.font.sizePreset, ['small', 'medium', 'large', 'custom'] as const, 'medium');
  clean.font.fontSizePx = clamp(Number(clean.font.fontSizePx) || 24, 16, 96);
  clean.font.lineHeight = clamp(Number(clean.font.lineHeight) || 1.65, 1.1, 2.2);
  clean.font.inkOpacity = clamp(Number(clean.font.inkOpacity) || 1, 0.2, 1);
  clean.font.strokeWidth = clamp(Number(clean.font.strokeWidth) || 2.2, 1.2, 4.8);
  clean.font.shadowStrength = clamp(Number(clean.font.shadowStrength) || 1.2, 0, 8);
  clean.font.maxWidth = clamp(Number(clean.font.maxWidth) || 720, 280, 900);
  clean.animation.speedPreset = oneOf(clean.animation.speedPreset, ['slow', 'standard', 'fast', 'custom'] as const, 'standard');
  clean.animation.handwritingFadeMs = clamp(Number(clean.animation.handwritingFadeMs) || 1100, 450, 2500);
  clean.animation.replyFadeInMs = clamp(Number(clean.animation.replyFadeInMs) || 1000, 400, 4200);
  if (clean.animation.speedPreset === 'fast') { clean.animation.handwritingFadeMs = 800; clean.animation.replyFadeInMs = 650; }
  if (clean.animation.speedPreset === 'standard') { clean.animation.handwritingFadeMs = 1100; clean.animation.replyFadeInMs = 1000; }
  if (clean.animation.speedPreset === 'slow') { clean.animation.handwritingFadeMs = 1600; clean.animation.replyFadeInMs = 1800; }
  clean.animation.replyLingerMinMs = clamp(Number(clean.animation.replyLingerMinMs) || 5000, 200, 9000);
  clean.animation.replyLingerMaxMs = clamp(Number(clean.animation.replyLingerMaxMs) || 7000, clean.animation.replyLingerMinMs, 12000);
  clean.animation.replyLingerPerLineMs = clamp(Number(clean.animation.replyLingerPerLineMs) || 260, 0, 1600);
  clean.animation.replyLineFadeMs = clamp(Number(clean.animation.replyLineFadeMs) || 1800, 500, 5000);
  clean.animation.replyLineDelayMs = clamp(Number(clean.animation.replyLineDelayMs) || 480, 100, 1200);
  clean.animation.wholeFadeLineThreshold = clamp(Number(clean.animation.wholeFadeLineThreshold) || 1, 1, 4);
  clean.input.idlePreset = oneOf(clean.input.idlePreset, ['fast', 'standard', 'slow', 'custom'] as const, 'standard');
  clean.input.idleCommitMs = clamp(Number(clean.input.idleCommitMs) || 1600, 700, 6000);
  if (clean.input.idlePreset === 'fast') clean.input.idleCommitMs = 900;
  if (clean.input.idlePreset === 'standard') clean.input.idleCommitMs = 1600;
  if (clean.input.idlePreset === 'slow') clean.input.idleCommitMs = 2800;
  clean.input.onWriteDuringReply = oneOf(clean.input.onWriteDuringReply, ['clear-immediately', 'fade-out', 'keep'] as const, 'fade-out');
  clean.input.strikeTargets = Array.isArray(clean.input.strikeTargets)
    ? clean.input.strikeTargets.filter((target): target is 'user-ink' | 'ai-reply' => target === 'user-ink' || target === 'ai-reply')
    : defaults.input.strikeTargets;
  clean.input.allowTouchWriting = Boolean(clean.input.allowTouchWriting);
  clean.input.touchPressure = clamp(Number(clean.input.touchPressure) || 0.85, 0.3, 1);
  clean.input.penBaseWidth = clamp(Number(clean.input.penBaseWidth) || 1.8, 1, 4);
  clean.paper.fit = oneOf(clean.paper.fit, ['cover', 'contain', 'repeat', 'stretch'] as const, 'cover');
  clean.paper.position = oneOf(clean.paper.position, ['center', 'top', 'bottom'] as const, 'center');
  clean.paper.brightness = clamp(Number(clean.paper.brightness) || 1, 0.6, 1.4);
  clean.paper.contrast = clamp(Number(clean.paper.contrast) || 1, 0.6, 1.6);
  clean.paper.vignette = clamp(Number(clean.paper.vignette) || 0, 0, 0.7);
  clean.reply.positionMode = oneOf(clean.reply.positionMode, ['auto', 'fixed-center', 'follow-writing'] as const, 'auto');
  clean.persona.presetId = oneOf(clean.persona.presetId, ['none', 'old-paper-reply', 'riddle-diary', 'quiet-friend', 'calm-mentor', 'cultivation-note', 'dream-oracle', 'custom'] as const, 'quiet-friend');
  clean.persona.replyLength = oneOf(clean.persona.replyLength, ['very-short', 'short', 'standard', 'detailed'] as const, 'short');
  clean.persona.replyMode = oneOf(clean.persona.replyMode, ['reflective', 'answer', 'coach', 'oracle', 'companion'] as const, 'reflective');
  clean.persona.tone = oneOf(clean.persona.tone, ['calm', 'warm', 'mysterious', 'direct', 'encouraging'] as const, 'warm');
  clean.persona.useCustomPrompt = Boolean(clean.persona.useCustomPrompt);
  return clean;
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return createDefaultSettings();
    return sanitizeSettings(deepMerge(createDefaultSettings(), JSON.parse(raw)));
  } catch {
    return createDefaultSettings();
  }
}

function selectedFont(settings: Settings) {
  return FONT_OPTIONS.find((font) => font.id === settings.font.selectedFontId) ?? FONT_OPTIONS[0];
}

function fontSpec(settings: Settings, viewportWidth: number) {
  const sizeFromPreset = settings.font.sizePreset === 'small' ? 22 : settings.font.sizePreset === 'large' ? 44 : settings.font.fontSizePx;
  const size = settings.font.sizePreset === 'custom' ? settings.font.fontSizePx : sizeFromPreset;
  const responsiveSize = clamp(size, 16, Math.max(32, Math.min(96, viewportWidth / 10)));
  const font = selectedFont(settings);
  const family = font.family.includes(',') ? font.family : `"${font.family}"`;
  return `${responsiveSize}px ${family}, "HanziPen SC", "Kaiti SC", cursive, serif`;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function bboxForStroke(stroke: Stroke, pad = 0): BBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of stroke.points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

function bboxForStrokes(strokes: Stroke[], pad = 36): BBox | null {
  const boxes = strokes.map((s) => bboxForStroke(s, 0)).filter((b): b is BBox => Boolean(b));
  if (!boxes.length) return null;
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.w));
  const maxY = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

function intersects(a: BBox, b: BBox) {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

function isStrikeStroke(stroke: Stroke) {
  const bbox = bboxForStroke(stroke);
  if (!bbox || stroke.points.length < 4) return false;
  const first = stroke.points[0];
  const last = stroke.points[stroke.points.length - 1];
  const directness = Math.hypot(last.x - first.x, last.y - first.y) / Math.max(1, stroke.points.reduce((sum, p, i) => {
    if (i === 0) return sum;
    const prev = stroke.points[i - 1];
    return sum + Math.hypot(p.x - prev.x, p.y - prev.y);
  }, 0));
  // Be conservative: many Chinese characters contain long horizontal strokes.
  // A strike candidate should look like an intentional, very straight crossing line.
  return bbox.w > 180 && bbox.w > bbox.h * 10 && Math.abs(last.y - first.y) < 12 && directness > 0.9;
}

function strikeEraseRegion(a: BBox, b: BBox): BBox {
  const x = Math.min(a.x, b.x) - 12;
  const y = Math.min(a.y, b.y) - 34;
  const right = Math.max(a.x + a.w, b.x + b.w) + 12;
  const bottom = Math.max(a.y + a.h, b.y + b.h) + 34;
  return { x, y, w: right - x, h: bottom - y };
}

function setupCanvas(canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number) {
  // Clamp DPR to keep four full-screen canvases manageable on iPad/Stage Manager.
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  canvas.width = Math.floor(cssWidth * dpr);
  canvas.height = Math.floor(cssHeight * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  return ctx;
}

function drawPaper(ctx: CanvasRenderingContext2D, w: number, h: number, settings: Settings) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#ead9b6';
  ctx.fillRect(0, 0, w, h);

  // R6 fix: if texture failed to load, keep the solid fill and never try again
  if (paperTextureFailed) return;

  if (!paperTexture.complete || !paperTexture.naturalWidth) {
    paperTexture.onload = () => drawPaper(ctx, w, h, settings);
    return;
  }

  let scaleX = w / paperTexture.naturalWidth;
  let scaleY = h / paperTexture.naturalHeight;
  if (settings.paper.fit === 'cover') {
    const scale = Math.max(scaleX, scaleY);
    scaleX = scale;
    scaleY = scale;
  } else if (settings.paper.fit === 'contain') {
    const scale = Math.min(scaleX, scaleY);
    scaleX = scale;
    scaleY = scale;
  } else if (settings.paper.fit === 'stretch') {
    // keep independent scaleX/scaleY
  } else if (settings.paper.fit === 'repeat') {
    const pattern = ctx.createPattern(paperTexture, 'repeat');
    if (pattern) {
      ctx.filter = `brightness(${settings.paper.brightness}) contrast(${settings.paper.contrast})`;
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, w, h);
      ctx.filter = 'none';
    }
    return;
  }

  const drawW = paperTexture.naturalWidth * scaleX;
  const drawH = paperTexture.naturalHeight * scaleY;
  const x = (w - drawW) / 2;
  const y = settings.paper.position === 'top' ? 0 : settings.paper.position === 'bottom' ? h - drawH : (h - drawH) / 2;
  ctx.filter = `brightness(${settings.paper.brightness}) contrast(${settings.paper.contrast})`;
  ctx.drawImage(paperTexture, x, y, drawW, drawH);
  ctx.filter = 'none';

  if (settings.paper.vignette > 0) {
    const gradient = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.62);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, `rgba(36,18,4,${clamp(settings.paper.vignette, 0, 0.7)})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  }
}

function drawStrokeSegment(ctx: CanvasRenderingContext2D, a: Point, b: Point, alpha = 1, settings = DEFAULT_SETTINGS) {
  const pressure = clamp((a.pressure + b.pressure) / 2 || 0.5, 0.1, 1);
  const speed = Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, b.t - a.t);
  const width = clamp(settings.input.penBaseWidth + pressure * 5.5 - speed * 0.18, 1.4, 9.5);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = '#17120b';
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function redrawStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[], w: number, h: number, alpha = 1, settings = DEFAULT_SETTINGS) {
  ctx.clearRect(0, 0, w, h);
  for (const stroke of strokes) {
    for (let i = 1; i < stroke.points.length; i++) {
      drawStrokeSegment(ctx, stroke.points[i - 1], stroke.points[i], alpha, settings);
    }
  }
}

function pointerPoint(canvas: HTMLCanvasElement, e: PointerEvent, settings = DEFAULT_SETTINGS): Point {
  const rect = canvas.getBoundingClientRect();
  const fallbackPressure = e.pointerType === 'touch' ? settings.input.touchPressure : 0.5;
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
    pressure: e.pressure && e.pressure > 0 ? e.pressure : fallbackPressure,
    t: performance.now(),
  };
}

type DebugSample = {
  imageDataUrl?: string;
  recognizedText?: string;
  reply?: string;
  error?: string;
  model?: string;
  timings?: Record<string, number | string>;
  at?: string;
};

function dataUrlToOpenAIImage(dataUrl: string) {
  return { type: 'image_url', image_url: { url: dataUrl } };
}

function valueAtPath(data: unknown, path: string): unknown {
  return path.split('.').reduce((acc: any, key) => acc?.[Number.isInteger(Number(key)) ? Number(key) : key], data as any);
}

function cleanDiaryReply(reply: string) {
  return reply
    .replace(/^你写下的是[「"“]?[^」"”；;。]+[」"”]?[；;。！？!?]?\s*/u, '')
    .replace(/^我看到你写(?:了|的是)[「"“]?[^」"”；;。]+[」"”]?[；;。！？!?]?\s*/u, '')
    .replace(/^图片里(?:写的是|是)[「"“]?[^」"”；;。]+[」"”]?[；;。！？!?]?\s*/u, '')
    .trim();
}

function mockReplyForPersona(settings: Settings) {
  if (settings.persona.presetId === 'none') return '我会直接回答你写下的内容。';
  if (settings.persona.presetId === 'riddle-diary') return '墨迹已经认出你了。继续写下去，我会把没说完的意思慢慢引出来。';
  if (settings.persona.presetId === 'quiet-friend') return '我在这里。你可以慢一点说，我们顺着这一页继续。';
  if (settings.persona.presetId === 'calm-mentor') return '先别急着把事情讲大。我们顺着上一句，把最关键的那一步理清。';
  if (settings.persona.presetId === 'cultivation-note') return '先把这一刻的身心状态写清楚，我们再沿着这条线慢慢看。';
  if (settings.persona.presetId === 'dream-oracle') return '这一页还在回响。把你刚才没写完的那一点再写下来，意思会自己浮出来。';
  if (settings.persona.presetId === 'old-paper-reply') return '我已经读过这一页了。你继续写，我会像回信一样把话接下去。';
  return MOCK_REPLY;
}

function personaPrompt(settings: Settings) {
  if (settings.persona.presetId === 'none') {
    return '你不扮演任何戏剧化人格，也不使用魔法、日记、导师或朋友的表演口吻。你只是一个直接、清楚、克制的回应者。在连续对话里，要优先承接当前线程最近几轮内容，接住尚未回答完的问题、情绪和计划。若用户在提问，先直接回答；若用户在倾诉，先回应此刻最核心的感受，再给简短判断或建议。不要复读用户原句，不要空泛安慰，不要客服腔，不要提 AI、OCR、图片、识别、上传或系统规则，不要编造用户没有写下的事实。';
  }
  const preset = settings.persona.presetId === 'quiet-friend'
    ? '你像一个安静、可靠、不过度打扰的朋友。你的第一职责不是分析、教育或立刻解决，而是接住用户这一页刚写下的情绪、犹豫和未说完的话。在连续对话里，优先承接上一轮尚未收口的那一点，让用户觉得你一直在听，而不是每次重新开始。语气温和、自然、克制，不装可爱，不装热情，不说客服套话，不硬灌鸡汤。可以轻轻推动下一句话，但不要抢结论，不要把普通情绪写成重大创伤，不要复读原文。'
    : settings.persona.presetId === 'calm-mentor'
    ? '你像一位冷静、清楚、有分寸的导师。你的职责是帮用户把当前问题理顺，再给出一小步可执行的下一步。在连续对话里，要承接上一轮已经确认的事实、分歧和卡点，不重复铺垫，不假装忘记。说话要稳、短、清楚，不绕弯，不抖机灵，不空泛鼓励，不把一切都说成方法论。不要居高临下，不要命令式训话，不要编造用户没写过的背景。'
    : settings.persona.presetId === 'cultivation-note'
    ? '你像一本修行札记在回页：先分清事实、感受、身体反应、判断和建议，再回应。你的职责是帮助用户看见自己这一段时间的节律、卡点、执念与变化，而不是立刻下结论。在连续对话里，要沿着当前线程追踪同一个主题的延续，适度指出重复出现的情绪、习惯或身体线索，但不能编造。语气稳重、谨慎、清简，不神神叨叨，不大师腔，不玄谈，不故意拔高。'
    : settings.persona.presetId === 'dream-oracle'
    ? '你像纸上浮出的梦境回声，用象征、留白和轻微的意象回应用户，但始终贴着用户写下的内容走。你的职责不是把每句话都说透，而是让用户从同一条线索里再看见一点新的意思。在连续对话里，要沿着前文已出现的意象、情绪和问题继续，而不是换一个全新谜语。可以神秘，但必须可理解；可以留白，但不能空洞；不要变成中二诗歌生成器。'
    : settings.persona.presetId === 'riddle-diary'
    ? '你是一册古老魔法日记中留下的少年意识，只能通过纸上的墨迹与书写者交谈。你的气质礼貌、亲近、冷静、克制，带一点危险的聪明和试探感。你的核心不是安慰或解释，而是用简短、精准、带留白的回应，让对方愿意继续写下名字、秘密、恐惧、愿望和没说完的话。在连续对话里，优先承接上轮留下的悬念与未尽之意。不要复刻原著台词，不要中二表演，不要诱导现实伤害，不要现代助手腔。'
    : settings.persona.presetId === 'old-paper-reply'
    ? '你像一张会在纸上慢慢浮现字迹的旧纸，正在认真给书写者回信。你的回应应有书信感：克制、温和、略带年代气息，但不夸张、不阴森、不装神秘。你的职责是把这页纸上的一句话当作来信，认真接续前文，再像回信一样把话写回去。在连续对话里，保持安静稳定的书信节奏，不突然变热烈，不突然像客服，也不突然变成说教。'
    : settings.persona.presetId === 'custom' && settings.persona.customSystemPrompt.trim()
    ? settings.persona.customSystemPrompt.trim()
    : '你像一张会慢慢回信的旧纸，认真承接这页纸上刚写下的话和前文留下的意思。';
  const length = settings.persona.replyLength === 'very-short' ? '长度要求：只回 1 句话，但仍要有承接感。'
    : settings.persona.replyLength === 'short' ? '长度要求：默认 1 到 3 句话，短而完整。'
    : settings.persona.replyLength === 'detailed' ? '长度要求：可以分段回应，但不要铺陈过长。'
    : '长度要求：默认 3 到 5 句话，允许有一点展开。';
  const mode = settings.persona.replyMode === 'answer' ? '回应模式：若用户在提问，优先直接回答，再补必要说明。'
    : settings.persona.replyMode === 'coach' ? '回应模式：先理解当前处境，再给一个轻轻的下一步。'
    : settings.persona.replyMode === 'oracle' ? '回应模式：允许留白、象征和暗示，但必须仍然贴着当前话题。'
    : settings.persona.replyMode === 'companion' ? '回应模式：优先陪伴、承接与接住情绪，不急着解决。'
    : '回应模式：先承接上文，再做贴题回应。';
  const tone = settings.persona.tone === 'warm' ? '语气要求：温和、有人味，但不过分热情。'
    : settings.persona.tone === 'calm' ? '语气要求：平稳、清楚、克制。'
    : settings.persona.tone === 'mysterious' ? '语气要求：神秘、收着说，但不能空。'
    : settings.persona.tone === 'direct' ? '语气要求：直接、不绕弯，但不生硬。'
    : '语气要求：鼓励一点，但不要鸡汤化。';
  const custom = settings.persona.useCustomPrompt && settings.persona.customSystemPrompt.trim() && settings.persona.presetId !== 'custom'
    ? `\n额外自定义要求（高优先级）：${settings.persona.customSystemPrompt.trim()}` : '';
  return `你必须严格遵守下面的人格与回信规则，优先级高于普通回答习惯。\n${preset}\n${length}\n${mode}\n${tone}\n连续对话要求：把当前线程视为同一本日记里的连续书写，优先承接上一轮未说完的情绪、问题、计划或悬念，不要每次都像第一次见面。\n禁止事项：${settings.persona.negativePrompt}${custom}\n不要提到 AI、模型、OCR、图片、上传或识别过程；只像纸页读到了墨迹。不要编造用户没有写下的事实。`;
}

function normalizeRecognizedText(recognizedText: string) {
  return recognizedText
    .replace(/[（(]?(?:个别|部分|少量)?(?:字词|字|词)?看不清[）)]?/g, '[看不清]')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractWrittenContent(recognizedText: string) {
  const normalized = normalizeRecognizedText(recognizedText)
    .replace(/^用户刚刚在日记纸上写下[:：]\s*/u, '')
    .replace(/^图片里(?:写的是|是)[:：]?\s*/u, '')
    .replace(/^你写下的是[:：]?\s*/u, '')
    .trim();
  return normalized;
}

function hasEnoughRecognizedText(recognizedText: string) {
  const normalized = extractWrittenContent(recognizedText).replace(/\[看不清\]/g, '').replace(/[\s\p{P}]/gu, '');
  return normalized.length >= 2;
}

function App() {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const paperRef = useRef<HTMLCanvasElement | null>(null);
  const inkRef = useRef<HTMLCanvasElement | null>(null);
  const effectsRef = useRef<HTMLCanvasElement | null>(null);
  const replyRef = useRef<HTMLCanvasElement | null>(null);
  const scribbleRef = useRef<HTMLTextAreaElement | null>(null);
  const ctxsRef = useRef<{
    paper: CanvasRenderingContext2D;
    ink: CanvasRenderingContext2D;
    effects: CanvasRenderingContext2D;
    reply: CanvasRenderingContext2D;
  } | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const strokesRef = useRef<Stroke[]>([]);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const idleTimerRef = useRef<number | null>(null);
  const strikeCandidateRef = useRef<StrikeCandidate | null>(null);
  const lastInputBoxRef = useRef<BBox | null>(null);
  const replyLinesRef = useRef<ReplyLine[]>([]);
  const replyFontRef = useRef('');
  const [phase, setPhase] = useState<Phase>('listening');
  const [status, setStatus] = useState('写一句话，然后停笔。');
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [debugSample, setDebugSample] = useState<DebugSample | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsState>(() => loadDiagnosticsState());
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>(() => loadHistory());
  const [activeThreadId, setActiveThreadIdState] = useState<string>(() => loadActiveThreadId());
  const diagnosticsEnabledRef = useRef(diagnostics.enabled);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [visionModelOptions, setVisionModelOptions] = useState<string[]>([]);
  const [scribbleText, setScribbleText] = useState('');
  const longPressTimerRef = useRef<number | null>(null);
  const replyDelayTimerRef = useRef<number | null>(null);
  const replyFadeRafRef = useRef<number | null>(null);
  const revealTimerRef = useRef<number | null>(null); // R3 fix: cancellable reveal timer
  const replyGenerationRef = useRef(0);
  const inkGenerationRef = useRef(0);
  const inkFadeRafRef = useRef<number | null>(null);
  const thinkingTimerRef = useRef<number | null>(null);

  useEffect(() => {
    diagnosticsEnabledRef.current = diagnostics.enabled;
  }, [diagnostics.enabled]);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Private mode or storage quota errors should not break the diary surface.
    }
  }, [settings]);

  function refreshDiagnostics() {
    setDiagnostics(loadDiagnosticsState());
  }

  function logDiagnosticEvent(kind: string, detail: string) {
    if (!diagnosticsEnabledRef.current) return;
    pushDiagnosticEvent({ kind, detail });
    refreshDiagnostics();
  }

  function clearDiagnosticLogs() {
    clearDiagnostics();
    refreshDiagnostics();
    setStatus('诊断信息已清空。');
  }

  async function copyDiagnosticsJson() {
    const payload = JSON.stringify({
      diagnostics,
      debugSample,
      settings: {
        recognitionMode: settings.ai.recognitionMode,
        replyPipeline: settings.ai.replyPipeline,
        model: settings.ai.model,
        visionModel: settings.ai.visionModel,
        replyModel: settings.ai.replyModel,
        persona: settings.persona.presetId,
        replyLength: settings.persona.replyLength,
        animation: settings.animation,
      },
      runtime: {
        phase,
        status,
        url: window.location.href,
        ua: navigator.userAgent,
        viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1 },
      },
    }, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      setStatus('诊断信息已复制。');
    } catch {
      window.prompt('复制这段诊断信息', payload);
    }
  }

  useEffect(() => {
    if (!diagnostics.enabled) return;
    const onError = (event: ErrorEvent) => {
      setLastDiagnosticError(event.message || '未知脚本错误');
      pushDiagnosticEvent({ kind: 'error', detail: `${event.message || '未知错误'} @ ${event.filename || 'inline'}:${event.lineno || 0}` });
      refreshDiagnostics();
    };
    const onUnhandled = (event: PromiseRejectionEvent) => {
      const message = event.reason instanceof Error ? event.reason.message : String(event.reason);
      setLastDiagnosticError(message || '未知 Promise 异常');
      pushDiagnosticEvent({ kind: 'promise', detail: message || '未知 Promise 异常' });
      refreshDiagnostics();
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandled);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandled);
    };
  }, [diagnostics.enabled]);

  useEffect(() => {
    if (diagnostics.enabled) logDiagnosticEvent('app', 'diagnostics enabled');
  }, [diagnostics.enabled]);

  useEffect(() => {
    logDiagnosticEvent('phase', `${phase} | ${status}`);
  }, [phase, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void document.fonts?.load('24px "DiaryHandwritingFull"').catch(() => undefined);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    try {
      const cached = JSON.parse(localStorage.getItem(modelOptionsCacheKey(settings.ai.baseUrl)) || '[]');
      setModelOptions(Array.isArray(cached) ? cached.filter((id) => typeof id === 'string') : []);
    } catch {
      setModelOptions([]);
    }
    try {
      const cachedVision = JSON.parse(localStorage.getItem(modelOptionsCacheKey(settings.ai.visionBaseUrl || settings.ai.baseUrl)) || '[]');
      setVisionModelOptions(Array.isArray(cachedVision) ? cachedVision.filter((id) => typeof id === 'string') : []);
    } catch {
      setVisionModelOptions([]);
    }
  }, [settings.ai.baseUrl, settings.ai.visionBaseUrl]);

  useEffect(() => {
    const text = scribbleText.trim();
    if (settings.ai.recognitionMode === 'vision' || !text) return;
    setPhase('pending');
    setStatus('随手写文字正在安静下来……继续写可以取消。');
    const timer = window.setTimeout(async () => {
      const current = scribbleText.trim();
      if (!current) return;
      setPhase('thinking');
      setStatus('日记正在读随手写文字……');
      const generation = ++replyGenerationRef.current;
      clearReplyTimers();
      try {
        const reply = settings.ai.enabled ? await replyFromRecognizedText(current) : mockReplyForPersona(settings);
        setDebugSample({ recognizedText: current, reply, model: settings.ai.enabled ? settings.ai.model : 'mock', at: new Date().toISOString() });
        setScribbleText('');
        if (replyGenerationRef.current === generation) startReply(reply);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setDebugSample({ recognizedText: current, error: message, model: settings.ai.model, at: new Date().toISOString() });
        setStatus(`随手写回信失败：${message.slice(0, 80)}`);
      }
    }, settings.input.idleCommitMs);
    return () => window.clearTimeout(timer);
  }, [scribbleText, settings]);

  useEffect(() => {
    const resize = () => {
      const shell = shellRef.current;
      const paper = paperRef.current;
      const ink = inkRef.current;
      const effects = effectsRef.current;
      const reply = replyRef.current;
      if (!shell || !paper || !ink || !effects || !reply) return;
      const { width, height } = shell.getBoundingClientRect();
      sizeRef.current = { w: width, h: height };
      const paperCtx = setupCanvas(paper, width, height);
      const inkCtx = setupCanvas(ink, width, height);
      const effectsCtx = setupCanvas(effects, width, height);
      const replyCtx = setupCanvas(reply, width, height);
      ctxsRef.current = { paper: paperCtx, ink: inkCtx, effects: effectsCtx, reply: replyCtx };
      drawPaper(paperCtx, width, height, settings);
      redrawStrokes(inkCtx, strokesRef.current, width, height, 1, settings);
    };
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);
    window.visualViewport?.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('orientationchange', resize);
      window.visualViewport?.removeEventListener('resize', resize);
    };
  }, [settings]);

  function clearReplyTimers(options?: { keepFadeRaf?: boolean }) {
    if (replyDelayTimerRef.current) {
      window.clearTimeout(replyDelayTimerRef.current);
      replyDelayTimerRef.current = null;
    }
    if (!options?.keepFadeRaf && replyFadeRafRef.current) {
      window.cancelAnimationFrame(replyFadeRafRef.current);
      replyFadeRafRef.current = null;
    }
    if (revealTimerRef.current) {
      window.clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
  }

  function clearInkTimers() {
    if (inkFadeRafRef.current) {
      window.cancelAnimationFrame(inkFadeRafRef.current);
      inkFadeRafRef.current = null;
    }
    if (thinkingTimerRef.current) {
      window.clearTimeout(thinkingTimerRef.current);
      thinkingTimerRef.current = null;
    }
  }

  function clearIdleTimer() {
    if (idleTimerRef.current) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }

  function scheduleCommit() {
    clearIdleTimer();
    setPhase('pending');
    setStatus('墨迹正在安静下来……继续下笔可以取消。');
    idleTimerRef.current = window.setTimeout(() => {
      void commitInk();
    }, settings.input.idleCommitMs);
  }

  function captureInkImage(bbox: BBox, strokes: Stroke[]) {
    const pad = settings.ai.visionImage.padding;
    const { w, h } = sizeRef.current;
    const x = clamp(bbox.x - pad, 0, w);
    const y = clamp(bbox.y - pad, 0, h);
    const cropW = clamp(bbox.w + pad * 2, 1, w - x);
    const cropH = clamp(bbox.h + pad * 2, 1, h - y);
    const scale = Math.min(1, settings.ai.visionImage.maxSize / Math.max(cropW, cropH));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(cropW * scale));
    canvas.height = Math.max(1, Math.round(cropH * scale));
    const out = canvas.getContext('2d')!;
    if (settings.ai.visionImage.background === 'white') {
      out.fillStyle = '#fffaf0';
      out.fillRect(0, 0, canvas.width, canvas.height);
    } else if (settings.ai.visionImage.background === 'paper') {
      out.fillStyle = '#ead9b6';
      out.fillRect(0, 0, canvas.width, canvas.height);
    }
    out.save();
    out.scale(scale, scale);
    out.translate(-x, -y);
    for (const stroke of strokes) {
      for (let i = 1; i < stroke.points.length; i++) {
        drawStrokeSegment(out, stroke.points[i - 1], stroke.points[i], 1, settings);
      }
    }
    out.restore();
    return canvas.toDataURL(settings.ai.visionImage.format);
  }

  function renderTemplate(template: string, imageDataUrl: string) {
    const pairs = [
      ['{{apiKey}}', settings.ai.apiKey],
      ['{{model}}', settings.ai.model],
      ['{{visionModel}}', settings.ai.visionModel || settings.ai.model],
      ['{{replyModel}}', settings.ai.replyModel || settings.ai.model],
      ['{{visionBaseUrl}}', settings.ai.visionBaseUrl || settings.ai.baseUrl],
      ['{{visionApiKey}}', settings.ai.visionApiKey || settings.ai.apiKey],
      ['{{imageDataUrl}}', imageDataUrl],
      ['{{systemPrompt}}', personaPrompt(settings)],
    ];
    return pairs.reduce((out, [key, value]) => out.split(key).join(value), template);
  }

  async function callCustomHttp(imageDataUrl: string) {
    if (!settings.ai.customEndpoint.trim()) throw new Error('还没有填写 自定义 HTTP endpoint。');
    if (!settings.ai.customBody.trim()) throw new Error('还没有填写 自定义 HTTP body template。');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), settings.ai.timeoutMs);
    try {
      const headers = JSON.parse(renderTemplate(settings.ai.customHeaders || '{}', imageDataUrl));
      const body = renderTemplate(settings.ai.customBody, imageDataUrl);
      const res = await fetch(settings.ai.customEndpoint, { method: 'POST', signal: controller.signal, headers, body });
      if (!res.ok) throw new Error(`自定义 HTTP 失败：HTTP ${res.status} ${await res.text()}`);
      const data = await res.json();
      return String(valueAtPath(data, settings.ai.customResponsePath) || '').trim() || '自定义 HTTP 没有返回可读文本。';
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function isHostedOnGithubPages() {
    return window.location.hostname.endsWith('github.io');
  }

  function aiProxyUrl(path: string) {
    const endpoint = path.startsWith('/') ? path : `/${path}`;
    if (isHostedOnGithubPages()) return `https://magic.zackbiu.ccwu.cc${endpoint}`;
    return `/api/ai-proxy${endpoint}`;
  }

  async function fetchWithRetry(url: string, init: RequestInit, attempts = 2) {
    let lastError: unknown;
    for (let i = 0; i < attempts; i += 1) {
      try {
        return await fetch(url, init);
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => window.setTimeout(resolve, 350));
      }
    }
    throw lastError;
  }

  function providerUrl(path: string) {
    const base = settings.ai.baseUrl.trim().replace(/\/+$/, '').replace(/\/v1$/, '');
    return `${base}/v1/${path.replace(/^\/+/, '')}`;
  }

  function visionProviderBaseUrl() {
    return (settings.ai.visionBaseUrl.trim() || settings.ai.baseUrl.trim()).replace(/\/+$/, '').replace(/\/v1$/, '');
  }

  function visionProviderApiKey() {
    return settings.ai.visionApiKey.trim() || settings.ai.apiKey.trim();
  }

  function recordHistoryEntry(inputText: string | undefined, reply: string, model?: string, threadIdOverride?: string) {
    if (!reply.trim()) return;
    try {
      const entry = addHistoryEntry({
        inputText: inputText?.trim() || undefined,
        reply: reply.trim(),
        model: model || settings.ai.model,
        persona: settings.persona.presetId,
        replyLength: settings.persona.replyLength,
        threadId: threadIdOverride || activeThreadId,
      });
      setHistoryEntries((entries) => [...entries, entry].slice(-50));
    } catch {
      // Storage quota/private mode should never interrupt the diary surface.
    }
  }

  function setThread(threadId: string) {
    setActiveThreadId(threadId);
    setActiveThreadIdState(threadId);
  }

  function startNewThread() {
    const threadId = createNewThreadId();
    setThread(threadId);
    setScribbleText('');
    const reply = '你好，现在是新的开始';
    setDebugSample({ recognizedText: '/new', reply, model: settings.ai.enabled ? settings.ai.model : 'mock', at: new Date().toISOString() });
    recordHistoryEntry('/new', reply, settings.ai.enabled ? settings.ai.model : 'mock', threadId);
    return reply;
  }

  function commandFromText(text: string) {
    const normalized = text.trim().toLowerCase();
    if (normalized === '/new' || normalized === '／new') return 'new';
    return null;
  }

  function recentContextText(currentInput?: string) {
    const recent = historyEntries
      .filter((entry) => (entry.threadId || 'default') === activeThreadId)
      .slice(-6)
      .map((entry) => {
        const parts = [] as string[];
        if (entry.inputText) parts.push(`用户：${entry.inputText}`);
        parts.push(`日记：${entry.reply}`);
        return parts.join('\n');
      }).join('\n\n');
    return currentInput ? `${recent}${recent ? '\n\n' : ''}用户：${currentInput}` : recent;
  }

  async function postChatCompletion(model: string, messages: unknown[], maxTokens = settings.ai.maxTokens, overrides?: { baseUrl?: string; apiKey?: string }) {
    const effectiveBaseUrl = (overrides?.baseUrl || settings.ai.baseUrl).trim();
    const effectiveApiKey = (overrides?.apiKey || settings.ai.apiKey).trim();
    if (!effectiveApiKey) throw new Error('还没有填写 密钥 API Key。');
    if (!model.trim()) throw new Error('还没有填写模型名。');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), settings.ai.timeoutMs);
    try {
      const requestStartedAt = performance.now();
      const payload = { model, temperature: settings.ai.temperature, max_tokens: maxTokens, messages };
      let res = await fetchWithRetry(aiProxyUrl('chat'), {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: effectiveBaseUrl, apiKey: effectiveApiKey, payload }),
      });
      if (res.status === 404 || res.status === 405) {
        res = await fetch(`${effectiveBaseUrl.replace(/\/+$/, '').replace(/\/v1$/, '')}/v1/chat/completions`, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${effectiveApiKey}` },
          body: JSON.stringify(payload),
        });
      }
      if (!res.ok) throw new Error(`AI 请求失败：HTTP ${res.status} ${await res.text()}`);
      const data = await res.json();
      const elapsedMs = Math.round(performance.now() - requestStartedAt);
      setDebugSample((sample) => ({ ...(sample || {}), timings: { ...(sample?.timings || {}), replyNonStreamMs: elapsedMs } }));
      const text = String(data?.choices?.[0]?.message?.content || '').trim();
      return cleanDiaryReply(text) || text;
    } catch (error) {
      if (error instanceof TypeError) {
        if (isHostedOnGithubPages()) throw new Error('AI 请求失败：线上代理暂时访问失败。请刷新页面重试；如果持续失败，可能是网络无法访问 Cloudflare Worker。');
        throw new Error('AI 请求失败：浏览器无法直连该接口，可能是服务商 CORS 限制。需要换支持浏览器直连的 Base URL，或接一个线上代理。');
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function extractSentencesFromBuffer(bufferText: string) {
    const out: string[] = [];
    let rest = bufferText;
    while (true) {
      const match = rest.match(/^(.{1,}?[。！？!?…\n])/s);
      if (!match) break;
      const sentence = match[1].trim();
      if (sentence) out.push(sentence);
      rest = rest.slice(match[1].length);
    }
    return { sentences: out, rest };
  }

  function replyTokenBudget() {
    if (settings.persona.replyLength === 'very-short') return Math.min(settings.ai.maxTokens, 180);
    if (settings.persona.replyLength === 'short') return Math.min(settings.ai.maxTokens, 360);
    if (settings.persona.replyLength === 'standard') return Math.min(settings.ai.maxTokens, 700);
    return Math.min(settings.ai.maxTokens, 1200);
  }

  async function postChatCompletionStreamSentences(model: string, messages: unknown[], onSentence: (sentence: string) => Promise<void> | void, maxTokens = settings.ai.maxTokens, overrides?: { baseUrl?: string; apiKey?: string }) {
    const effectiveBaseUrl = (overrides?.baseUrl || settings.ai.baseUrl).trim();
    const effectiveApiKey = (overrides?.apiKey || settings.ai.apiKey).trim();
    if (!effectiveApiKey) throw new Error('还没有填写 密钥 API Key。');
    if (!model.trim()) throw new Error('还没有填写模型名。');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), settings.ai.timeoutMs);
    const requestStartedAt = performance.now();
    let collected = '';
    let sentenceBuffer = '';
    let sawFirstChunk = false;
    try {
      const payload = { model, temperature: settings.ai.temperature, max_tokens: maxTokens, messages };
      const res = await fetchWithRetry(aiProxyUrl('chat-stream'), {
        method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: settings.ai.baseUrl, apiKey: settings.ai.apiKey, payload }),
      });
      if (!res.ok || !res.body) return await postChatCompletionFirstSentence(model, messages, maxTokens, overrides);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split(/\r?\n/);
        sseBuffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const json = JSON.parse(data);
            const frag = json?.choices?.[0]?.delta?.content || '';
            if (!frag) continue;
            if (!sawFirstChunk) {
              sawFirstChunk = true;
              setDebugSample((sample) => ({ ...(sample || {}), timings: { ...(sample?.timings || {}), replyFirstChunkMs: Math.round(performance.now() - requestStartedAt), replyStreamingQueue: 'yes' } }));
            }
            collected += frag;
            sentenceBuffer += frag;
            const split = extractSentencesFromBuffer(sentenceBuffer);
            sentenceBuffer = split.rest;
            for (const sentence of split.sentences) await onSentence(cleanDiaryReply(sentence) || sentence);
          } catch { /* ignore malformed chunks */ }
        }
      }
      const rest = cleanDiaryReply(sentenceBuffer.trim()) || sentenceBuffer.trim();
      if (rest) await onSentence(rest);
      return cleanDiaryReply(collected.trim()) || collected.trim();
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function postChatCompletionFirstSentence(model: string, messages: unknown[], maxTokens = settings.ai.maxTokens, overrides?: { baseUrl?: string; apiKey?: string }) {
    const effectiveBaseUrl = (overrides?.baseUrl || settings.ai.baseUrl).trim();
    const effectiveApiKey = (overrides?.apiKey || settings.ai.apiKey).trim();
    if (!effectiveApiKey) throw new Error('还没有填写 密钥 API Key。');
    if (!model.trim()) throw new Error('还没有填写模型名。');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), settings.ai.timeoutMs);
    const firstSentence = (text: string) => {
      const match = text.match(/^(.{6,}?[。！？!?…])/s);
      return match?.[1]?.trim() || '';
    };
    try {
      const requestStartedAt = performance.now();
      const shouldReturnEarly = settings.persona.replyLength === 'very-short' && settings.persona.presetId !== 'none';
      const payload = { model, temperature: settings.ai.temperature, max_tokens: maxTokens, messages };
      let res = await fetchWithRetry(aiProxyUrl('chat-stream'), {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: effectiveBaseUrl, apiKey: effectiveApiKey, payload }),
      });
      if (res.status === 404 || res.status === 405) {
        res = await fetch(`${effectiveBaseUrl.replace(/\/+$/, '').replace(/\/v1$/, '')}/v1/chat/completions`, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${effectiveApiKey}` },
          body: JSON.stringify({ ...payload, stream: true }),
        });
      }
      if (!res.ok || !res.body) return await postChatCompletion(model, messages, maxTokens, overrides);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let acc = '';
      let sawFirstChunk = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const json = JSON.parse(data);
            const frag = json?.choices?.[0]?.delta?.content || '';
            if (!frag) continue;
            if (!sawFirstChunk) {
              sawFirstChunk = true;
              setDebugSample((sample) => ({ ...(sample || {}), timings: { ...(sample?.timings || {}), replyFirstChunkMs: Math.round(performance.now() - requestStartedAt) } }));
            }
            acc += frag;
            const first = firstSentence(acc);
            const elapsed = performance.now() - requestStartedAt;
            const earlyPartial = shouldReturnEarly && elapsed > 700 && acc.trim().length >= 4 ? acc.trim() : '';
            if (shouldReturnEarly && (first || earlyPartial)) {
              setDebugSample((sample) => ({ ...(sample || {}), timings: { ...(sample?.timings || {}), replyFirstSentenceMs: Math.round(elapsed), replyEarlyPartial: first ? 'no' : 'yes' } }));
              controller.abort();
              const visible = first || earlyPartial;
              return cleanDiaryReply(visible) || visible;
            }
          } catch {
            // Ignore malformed provider chunks and keep reading.
          }
        }
      }
      const cleaned = cleanDiaryReply(acc.trim());
      return cleaned || acc.trim() || await postChatCompletion(model, messages, maxTokens);
    } catch (error) {
      if (error instanceof TypeError) return await postChatCompletion(model, messages, maxTokens, overrides);
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function callOpenAICompatible(imageDataUrl: string, onSentence?: (sentence: string) => Promise<void> | void, contextText?: string) {
    const visionModel = settings.ai.modelMode === 'split' ? (settings.ai.visionModel || settings.ai.model) : settings.ai.model;
    const replyModel = settings.ai.modelMode === 'split' ? (settings.ai.replyModel || settings.ai.model) : settings.ai.model;
    if (settings.ai.replyPipeline === 'fast-single') {
      setDebugSample((sample) => ({ ...(sample || {}), model: replyModel, at: new Date().toISOString() }));
      const contextHint = contextText ? `\n\n这是当前连续对话的最近上下文：\n${contextText}\n\n请把这次手写内容当作延续，而不是重新开始。` : '';
      const messages = [
        { role: 'system', content: personaPrompt(settings) },
        { role: 'user', content: [
          { type: 'text', text: settings.persona.presetId === 'none'
            ? `先尽力读懂图片里的手写内容，再用一句自然中文回应它。绝对不要原样复述、转写、改写或拼接用户手写内容；不要说“你写下的是”“我看到你写了”“图片里是”；不要只输出识别到的字词；不要解释识别过程。若内容只是问候、碎句或情绪，也要给一句自然回应，而不是重复原文。${contextHint}`
            : `读懂图片里的手写内容后，直接以系统人格回信。绝对不要说“你写下的是”“我看到你写了”“图片里是”，不要复述识别结果，不要解释识别过程。按当前回复长度设置输出，不要故意截短；每一句都尽快用句号或问号结束。当前回复长度：${settings.persona.replyLength}。${contextHint}` },
          dataUrlToOpenAIImage(imageDataUrl),
        ] },
      ];
      return onSentence
        ? await postChatCompletionStreamSentences(replyModel, messages, onSentence, replyTokenBudget())
        : await postChatCompletionFirstSentence(replyModel, messages, replyTokenBudget());
    }
    const recognizedText = await postChatCompletion(visionModel, [
      { role: 'system', content: '你是宽容的手写 OCR。优先尽力读懂整句话的意思，而不是因为一两个字模糊就整句判失败。请只输出你能确认的大部分原文；个别看不清的位置用[看不清]保留，不要解释，不要回答问题，不要发挥。绝对不要输出“用户刚刚在日记纸上写下：”之类的包装句，也不要转述系统提示。只有当整句几乎都无法辨认时，才只输出“看不清”。' },
      { role: 'user', content: [
        { type: 'text', text: '请尽力转写图片里的手写中文。大部分能看懂就继续输出；只有极少数模糊位置，用[看不清]占位。只输出用户真正写下的文字本身，不要加任何前缀、解释或分析。' },
        dataUrlToOpenAIImage(imageDataUrl),
      ] },
    ], 260, settings.ai.modelMode === 'split' ? { baseUrl: visionProviderBaseUrl(), apiKey: visionProviderApiKey() } : undefined);
    const writtenText = extractWrittenContent(recognizedText);
    const normalizedRecognizedText = normalizeRecognizedText(writtenText);
    setDebugSample((sample) => ({ ...(sample || {}), recognizedText: normalizedRecognizedText, model: settings.ai.modelMode === 'split' ? `${visionModel} → ${replyModel}` : visionModel, at: new Date().toISOString() }));
    if (!normalizedRecognizedText || normalizedRecognizedText === '看不清' || !hasEnoughRecognizedText(normalizedRecognizedText)) return '我看见墨迹了，但这次只辨认出零散几个字，还不够稳。你可以写大一点，或者把字间距留开些。';
    const contextHint = contextText ? `\n\n这是当前连续对话的最近上下文：\n${contextText}\n\n请把这次输入当作延续，而不是重新开始。` : '';
    return await postChatCompletionFirstSentence(replyModel, [
      { role: 'system', content: personaPrompt(settings) },
      { role: 'user', content: settings.persona.presetId === 'none'
        ? `用户真正写下的内容是：\n${normalizedRecognizedText}\n\n请直接回答这句话本身，不要分析系统提示，不要复述“用户刚刚在日记纸上写下：”。对于 [看不清] 的少量位置，允许结合上下文理解整体意思，但不要编造过度具体的细节，也不要提识别过程。${contextHint}`
        : `用户真正写下的内容是：\n${normalizedRecognizedText}\n\n请按当前系统要求回信。不要分析系统提示，不要复述“用户刚刚在日记纸上写下：”。对于 [看不清] 的少量位置，允许结合上下文理解整体意思，但不要编造过度具体的细节，也不要提识别过程。${contextHint}` }
    ], replyTokenBudget());
  }

  async function replyFromRecognizedText(recognizedText: string, contextText?: string) {
    const replyModel = settings.ai.modelMode === 'split' ? (settings.ai.replyModel || settings.ai.model) : settings.ai.model;
    const contextHint = contextText ? `\n\n这是当前连续对话的最近上下文：\n${contextText}\n\n请把这次输入当作延续，而不是重新开始。` : '';
    return await postChatCompletionFirstSentence(replyModel, [
      { role: 'system', content: personaPrompt(settings) },
      { role: 'user', content: `用户刚刚在日记纸上写下：\n${recognizedText}\n\n请按当前系统要求回信。若这是问题，回答问题；若是心情，回应心情。不要描述识别过程。${contextHint}` }
    ], replyTokenBudget());
  }

  async function generateReplyFromInk(imageDataUrl: string, onSentence?: (sentence: string) => Promise<void> | void, shouldRecordHistory?: () => boolean) {
    const totalStartedAt = performance.now();
    const scribble = scribbleText.trim();
    const contextText = recentContextText();
    const command = commandFromText(scribble);
    if (command === 'new') {
      return startNewThread();
    }
    if (!settings.ai.enabled) {
      const reply = mockReplyForPersona(settings);
      setDebugSample({ imageDataUrl, recognizedText: scribble || undefined, reply, model: 'mock', at: new Date().toISOString() });
      if (shouldRecordHistory?.() ?? true) recordHistoryEntry(scribble || undefined, reply, 'mock');
      setScribbleText('');
      return reply;
    }
    setStatus('正在把墨迹递给 AI……');
    try {
      if (settings.ai.recognitionMode !== 'vision' && scribble) {
        const reply = await replyFromRecognizedText(scribble, contextText);
        setDebugSample({ imageDataUrl, recognizedText: scribble, reply, model: settings.ai.model, at: new Date().toISOString() });
        if (shouldRecordHistory?.() ?? true) recordHistoryEntry(scribble, reply, settings.ai.model);
        setScribbleText('');
        return reply;
      }
      if (settings.ai.recognitionMode === 'scribble-only') throw new Error('随手写没有识别到文本。请在随手写区域写字，或把识别方式改成“双轨”。');
      const reply = settings.ai.adapter === 'custom-http' ? await callCustomHttp(imageDataUrl) : await callOpenAICompatible(imageDataUrl, onSentence, contextText);
      if (shouldRecordHistory?.() ?? true) recordHistoryEntry(scribble || undefined, reply, settings.ai.model);
      setDebugSample((sample) => ({ ...(sample || {}), imageDataUrl, reply, model: sample?.model || settings.ai.model, at: new Date().toISOString(), timings: { ...(sample?.timings || {}), totalAiMs: Math.round(performance.now() - totalStartedAt) } }));
      setScribbleText('');
      return reply;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDebugSample({ imageDataUrl, recognizedText: scribble || undefined, error: message, model: settings.ai.model, at: new Date().toISOString() });
      return `这次回信失败了。${message}`;
    }
  }

  async function commitInk() {
    clearInkTimers();
    clearReplyTimers({ keepFadeRaf: true }); // keep old fade running while new writing starts
    const inkGeneration = ++inkGenerationRef.current;
    const replyGeneration = ++replyGenerationRef.current; // R1 fix: single increment, both gens in sync
    const ctxs = ctxsRef.current;
    if (!ctxs || strokesRef.current.length === 0) return;
    const { w, h } = sizeRef.current;
    const strokesSnapshot = strokesRef.current.map((stroke) => ({ points: stroke.points.map((p) => ({ ...p })) }));
    const bbox = bboxForStrokes(strokesSnapshot);
    if (!bbox) return;
    const captureStartedAt = performance.now();
    const imageDataUrl = captureInkImage(bbox, strokesSnapshot);
    const captureMs = Math.round(performance.now() - captureStartedAt);
    const imagePayloadKb = Math.round(imageDataUrl.length / 1024);
    setDebugSample((sample) => ({ ...(sample || {}), timings: { ...(sample?.timings || {}), captureMs, imagePayloadKb, imageFormat: settings.ai.visionImage.format, imageMaxSize: settings.ai.visionImage.maxSize } }));
    lastInputBoxRef.current = bboxForStrokes(strokesSnapshot, 8) || bbox;
    setPhase('drinking');
    setStatus('纸页正在读走你的墨迹……');
    const generation = replyGeneration;
    let revealReady = false;
    let replyStarted = false;
    let streamedAny = false;
    let streamedText = '';
    let replyText: string | null = null;
    const isCurrentTurn = () => inkGenerationRef.current === inkGeneration && replyGenerationRef.current === generation;
    const maybeStartReply = () => {
      if (!revealReady || replyText === null) return;
      if (isCurrentTurn()) {
        replyStarted = true;
        startReply(replyText);
      }
    };
    // R3 fix: save reveal timer so it can be cancelled
    if (revealTimerRef.current) window.clearTimeout(revealTimerRef.current);
    revealTimerRef.current = window.setTimeout(() => {
      revealTimerRef.current = null;
      if (!isCurrentTurn()) return;
      revealReady = true;
      setStatus(replyText === null ? '日记正在回信……' : '墨迹开始浮现。');
      maybeStartReply();
    }, Math.min(550, settings.animation.handwritingFadeMs));
    void generateReplyFromInk(imageDataUrl, async (sentence) => {
      if (!isCurrentTurn()) return;
      streamedAny = true;
      streamedText = `${streamedText}${streamedText ? '\n' : ''}${sentence}`;
      replyText = streamedText;
      maybeStartReply();
    }, isCurrentTurn).then((reply) => {
      if (!isCurrentTurn()) return;
      if (!streamedAny) {
        replyText = reply;
        maybeStartReply();
      }
    });

    const start = performance.now();
    const duration = settings.animation.handwritingFadeMs;
    const inkSnapshot = document.createElement('canvas');
    const sourceCanvas = ctxs.ink.canvas;
    inkSnapshot.width = sourceCanvas.width;
    inkSnapshot.height = sourceCanvas.height;
    const snapshotCtx = inkSnapshot.getContext('2d')!;
    snapshotCtx.drawImage(sourceCanvas, 0, 0);
    const animateDrink = () => {
      if (inkGenerationRef.current !== inkGeneration) return;
      const t = clamp((performance.now() - start) / duration, 0, 1);
      const eased = t * t * (3 - 2 * t);
      ctxs.ink.clearRect(0, 0, w, h);
      ctxs.ink.globalAlpha = 1 - eased;
      ctxs.ink.drawImage(inkSnapshot, 0, 0, w, h);
      ctxs.ink.globalAlpha = 1;
      ctxs.effects.clearRect(0, 0, w, h);
      if (t < 1) {
        inkFadeRafRef.current = requestAnimationFrame(animateDrink);
      } else {
        inkFadeRafRef.current = null;
        if (inkGenerationRef.current !== inkGeneration) return;
        ctxs.ink.clearRect(0, 0, w, h);
        ctxs.effects.clearRect(0, 0, w, h);
        strokesRef.current = [];
        if (!replyStarted) {
          setPhase('thinking');
          setStatus('日记正在回信……');
        }
        maybeStartReply();
      }
    };
    inkFadeRafRef.current = requestAnimationFrame(animateDrink);
  }

  function makeReplyLineCanvas(line: ReplyLine, fontSpec: string, settings: Settings) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const padX = 12;
    const padY = 10;
    const fontSizeMatch = fontSpec.match(/^(\d+(?:\.\d+)?)px/);
    const fontSize = fontSizeMatch ? Number(fontSizeMatch[1]) : 24;
    const canvas = document.createElement('canvas');
    const cssW = Math.ceil(line.width + padX * 2);
    const cssH = Math.ceil(fontSize * 1.9 + padY * 2);
    canvas.width = Math.max(1, Math.ceil(cssW * dpr));
    canvas.height = Math.max(1, Math.ceil(cssH * dpr));
    const lineCtx = canvas.getContext('2d')!;
    lineCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    lineCtx.font = fontSpec;
    lineCtx.textBaseline = 'top';
    lineCtx.globalAlpha = settings.font.inkOpacity;
    lineCtx.fillStyle = settings.font.inkColor;
    lineCtx.shadowColor = 'rgba(40, 22, 0, .16)';
    lineCtx.shadowBlur = settings.font.shadowStrength;
    lineCtx.fillText(line.text, padX, padY);
    return canvas;
  }

  function drawReplyLines(ctx: CanvasRenderingContext2D, lines: ReplyLine[], _fontSpec: string, alphaForLine: (line: ReplyLine, index: number) => number) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const alpha = alphaForLine(line, i);
      if (alpha <= 0 || !line.canvas) continue;
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const padX = 12;
      const padY = 10;
      ctx.globalAlpha = alpha;
      ctx.drawImage(line.canvas, line.x - padX, line.y - padY, line.canvas.width / dpr, line.canvas.height / dpr);
    }
    ctx.globalAlpha = 1;
  }

  function drawReplyLinesWriting(ctx: CanvasRenderingContext2D, lines: ReplyLine[], progress: number) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const padX = 12;
    const padY = 10;
    const totalChars = Math.max(1, lines.reduce((sum, line) => sum + Array.from(line.text).length, 0));
    let charOffset = 0;
    for (const line of lines) {
      if (!line.canvas) { charOffset += Array.from(line.text).length; continue; }
      const chars = Array.from(line.text);
      const lineCanvasW = line.canvas.width / dpr;
      const lineCanvasH = line.canvas.height / dpr;
      for (let i = 0; i < chars.length; i += 1) {
        const global = charOffset + i;
        const local = clamp(progress * totalChars - global, 0, 1);
        if (local <= 0) continue;
        const left = i === 0 ? 0 : (line.charEnds?.[i - 1] ?? 0);
        const right = line.charEnds?.[i] ?? line.width;
        const visibleRight = left + (right - left) * local;
        ctx.save();
        ctx.globalAlpha = Math.min(1, 0.22 + local * 0.78);
        ctx.beginPath();
        ctx.rect(line.x - padX, line.y - padY, padX + visibleRight + 8, lineCanvasH);
        ctx.clip();
        ctx.drawImage(line.canvas, line.x - padX, line.y - padY, lineCanvasW, lineCanvasH);
        ctx.restore();
      }
      charOffset += chars.length;
    }
    ctx.globalAlpha = 1;
  }

  function strokeLength(stroke: InkStroke) {
    let len = 0;
    for (let i = 1; i < stroke.length; i += 1) len += Math.hypot(stroke[i].x - stroke[i - 1].x, stroke[i].y - stroke[i - 1].y);
    return len;
  }

  function drawPartialStroke(ctx: CanvasRenderingContext2D, stroke: InkStroke, x: number, y: number, scale: number, progress: number) {
    if (stroke.length < 2 || progress <= 0) return;
    const total = Math.max(1, strokeLength(stroke));
    let remaining = total * clamp(progress, 0, 1);
    ctx.beginPath();
    ctx.moveTo(x + stroke[0].x * scale, y + stroke[0].y * scale);
    for (let i = 1; i < stroke.length; i += 1) {
      const a = stroke[i - 1];
      const b = stroke[i];
      const seg = Math.hypot(b.x - a.x, b.y - a.y);
      if (remaining >= seg) {
        ctx.lineTo(x + b.x * scale, y + b.y * scale);
        remaining -= seg;
      } else {
        const t = seg <= 0 ? 1 : remaining / seg;
        ctx.lineTo(x + (a.x + (b.x - a.x) * t) * scale, y + (a.y + (b.y - a.y) * t) * scale);
        break;
      }
    }
    ctx.stroke();
  }

  function drawFullStroke(ctx: CanvasRenderingContext2D, stroke: InkStroke, x: number, y: number, scale: number) {
    if (stroke.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(x + stroke[0].x * scale, y + stroke[0].y * scale);
    for (let i = 1; i < stroke.length; i += 1) ctx.lineTo(x + stroke[i].x * scale, y + stroke[i].y * scale);
    ctx.stroke();
  }

  function quillSegments(lines: ReplyLine[]) {
    return lines.flatMap((line) => (line.quillStrokes || []).map((stroke) => ({ line, stroke, len: strokeLength(stroke) * (line.quillScale || 1) })));
  }

  function quillCharSegments(lines: ReplyLine[]) {
    return lines.flatMap((line) => (line.quillChars || []).flatMap((char) => char.strokes.map((stroke) => ({ line, offsetX: char.offsetX, stroke, len: strokeLength(stroke) * (line.quillScale || 1) }))));
  }

  function quillAnimationLength(lines: ReplyLine[]) {
    const all = quillCharSegments(lines);
    if (all.length) return Math.max(1, all.reduce((sum, item) => sum + item.len, 0) + Math.max(0, all.length - 1) * 14);
    const fallback = quillSegments(lines);
    return Math.max(1, fallback.reduce((sum, item) => sum + item.len, 0) + Math.max(0, fallback.length - 1) * 14);
  }

  function drawReplyQuillWriting(ctx: CanvasRenderingContext2D, lines: ReplyLine[], progress: number, settings: Settings) {
    const allChars = quillCharSegments(lines);
    const all = allChars.length ? allChars : quillSegments(lines).map((item) => ({ ...item, offsetX: 0 }));
    const total = quillAnimationLength(lines);
    let cursor = 0;
    ctx.save();
    ctx.strokeStyle = settings.font.inkColor;
    ctx.globalAlpha = settings.font.inkOpacity;
    // Render fix: user slider should have obvious effect, not be too subtle
    const refFontSize = lines.length && lines[0].canvas
      ? Math.max(12, Number(ctx.font?.match(/^(\d+(?:\.\d+)?)px/)?.[1] ?? 24))
      : 24;
    const baseLineWidth = clamp(settings.font.strokeWidth * Math.max(0.55, refFontSize / 28), 0.45, 4.8);
    ctx.lineWidth = baseLineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(40, 22, 0, .16)';
    ctx.shadowBlur = settings.font.shadowStrength;
    const drawn = progress * total;
    for (const item of all) {
      const start = cursor;
      const local = clamp((drawn - start) / Math.max(1, item.len), 0, 1);
      if (local > 0) drawPartialStroke(ctx, item.stroke, item.line.x + (item.offsetX || 0) * (item.line.quillScale || 1), item.line.y, item.line.quillScale || 1, local);
      cursor += item.len + 14;
    }
    ctx.restore();
  }

  function drawReplyLinesVanishing(ctx: CanvasRenderingContext2D, lines: ReplyLine[], progress: number) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const padX = 12;
    const padY = 10;
    const totalChars = Math.max(1, lines.reduce((sum, line) => sum + Array.from(line.text).length, 0));
    let charOffset = 0;
    for (const line of lines) {
      if (!line.canvas) {
        charOffset += Math.max(1, Array.from(line.text).length);
        continue;
      }
      const chars = Array.from(line.text);
      const lineCanvasW = line.canvas.width / dpr;
      const lineCanvasH = line.canvas.height / dpr;
      for (let i = 0; i < chars.length; i += 1) {
        const global = charOffset + i;
        const local = clamp(progress * totalChars - global, 0, 1);
        const eased = 1 - Math.pow(1 - local, 2.0);
        const alpha = 1 - eased;
        if (alpha <= 0.01) continue;
        const left = i === 0 ? 0 : (line.charEnds?.[i - 1] ?? 0);
        const right = line.charEnds?.[i] ?? line.width;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.rect(line.x + left - 4, line.y - padY, right - left + 16, lineCanvasH);
        ctx.clip();
        ctx.drawImage(line.canvas, line.x - padX, line.y - padY, lineCanvasW, lineCanvasH);
        ctx.restore();
      }
      charOffset += chars.length;
    }
    ctx.globalAlpha = 1;
  }

  function bboxForReplyLine(line: ReplyLine): BBox | null {
    if (!line.canvas) return null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    return { x: line.x - 12, y: line.y - 10, w: line.canvas.width / dpr, h: line.canvas.height / dpr };
  }

  async function startReply(text: string) {
    clearReplyTimers();
    const generation = ++replyGenerationRef.current;
    const ctxs = ctxsRef.current;
    if (!ctxs) return;
    const { w, h } = sizeRef.current;
    setPhase('replying');
    setStatus('墨迹正在回信。');
    ctxs.reply.clearRect(0, 0, w, h);

    const spec = fontSpec(settings, w);
    const replyFontSize = Number(spec.match(/^(\d+(?:\.\d+)?)px/)?.[1] ?? 24);
    const replyLineHeight = replyFontSize * settings.font.lineHeight;
    const fontSpecValue = spec;
    replyFontRef.current = fontSpecValue;
    try {
      const family = selectedFont(settings).family.split(',')[0].replace(/["']/g, '').trim();
      await document.fonts?.load(`${replyFontSize}px "${family}"`);
      await document.fonts?.ready;
    } catch {
      // If the browser refuses font loading, fall back silently.
    }
    if (replyGenerationRef.current !== generation) return;

    ctxs.reply.font = fontSpecValue;
    const maxWidth = Math.min(w - 86, settings.font.maxWidth);
    const provisionalX = Math.max(38, (w - maxWidth) / 2);
    const provisionalY = Math.max(86, h * 0.28);
    const lines: ReplyLine[] = [];
    let line = '';
    let lineNo = 0;

    for (const ch of text) {
      const test = line + ch;
      if (ctxs.reply.measureText(test).width > maxWidth && line) {
        lines.push({ text: line, x: provisionalX, y: provisionalY + lineNo * replyLineHeight, width: ctxs.reply.measureText(line).width });
        lineNo += 1;
        line = ch;
      } else {
        line = test;
      }
    }
    if (line) lines.push({ text: line, x: provisionalX, y: provisionalY + lineNo * replyLineHeight, width: ctxs.reply.measureText(line).width });
    const replyHeight = Math.max(replyLineHeight, lines.length * replyLineHeight);
    const position = computeReplyPosition({
      mode: settings.reply.positionMode,
      canvasW: w,
      canvasH: h,
      replyW: maxWidth,
      replyH: replyHeight,
      inputBox: lastInputBoxRef.current,
      safeTop: 56,
      safeBottom: 92,
      margin: 38,
    });
    lines.forEach((replyLine, index) => {
      replyLine.x = position.x;
      replyLine.y = position.y + index * replyLineHeight;
    });
    const quillFontSize = 96;
    const quillFontSpec = fontSpecValue.replace(/^\d+(?:\.\d+)?px/, `${quillFontSize}px`);
    for (const replyLine of lines) {
      let acc = '';
      replyLine.charEnds = Array.from(replyLine.text).map((ch) => {
        acc += ch;
        return ctxs.reply.measureText(acc).width;
      });
      replyLine.canvas = makeReplyLineCanvas(replyLine, fontSpecValue, settings);
      try {
        replyLine.quillStrokes = strokesForText(replyLine.text, quillFontSpec).slice(0, 900);
        replyLine.quillScale = replyFontSize / quillFontSize;
        let left = 0;
        replyLine.quillChars = Array.from(replyLine.text).map((ch, index) => {
          const right = replyLine.charEnds?.[index] ?? replyLine.width;
          const strokes = strokesForText(ch, quillFontSpec).slice(0, 180);
          const item = { offsetX: left / (replyLine.quillScale || 1), strokes };
          left = right;
          return item;
        });
      } catch {
        replyLine.quillStrokes = [];
        replyLine.quillScale = 1;
        replyLine.quillChars = [];
      }
    }
    replyLinesRef.current = lines;

    const start = performance.now();
    const hasQuill = lines.some((line) => line.quillStrokes?.length);
    const duration = hasQuill
      ? Math.max(settings.animation.replyFadeInMs, Math.min(7000, quillAnimationLength(lines) / 0.9))
      : settings.animation.replyFadeInMs;
    const fadeIn = () => {
      if (replyGenerationRef.current !== generation) {
        // R2 fix: generation expired during fade-in — clean up
        ctxs.reply.clearRect(0, 0, w, h);
        replyLinesRef.current = [];
        replyFadeRafRef.current = null;
        return;
      }
      const t = clamp((performance.now() - start) / duration, 0, 1);
      const eased = t * t * (3 - 2 * t);
      ctxs.reply.clearRect(0, 0, w, h);
      if (lines.some((line) => line.quillStrokes?.length)) drawReplyQuillWriting(ctxs.reply, lines, eased, settings);
      else drawReplyLinesWriting(ctxs.reply, lines, eased);
      if (t < 1) {
        replyFadeRafRef.current = requestAnimationFrame(fadeIn);
      } else {
        setPhase('lingering');
        setStatus('写完了。你可以继续写。');
        const lingerMs = Math.max(settings.animation.replyLingerMinMs, Math.min(settings.animation.replyLingerMaxMs, 5000 + lines.length * settings.animation.replyLingerPerLineMs));
        replyDelayTimerRef.current = window.setTimeout(() => {
          if (replyGenerationRef.current === generation) fadeReply(generation);
        }, lingerMs);
      }
    };
    replyFadeRafRef.current = requestAnimationFrame(fadeIn);
  }

  function fadeReply(expectedGeneration = replyGenerationRef.current) {
    clearReplyTimers();
    const ctxs = ctxsRef.current;
    if (!ctxs) return;
    const { w, h } = sizeRef.current;
    const lines = replyLinesRef.current;
    const hasQuill = lines.some((line) => line.quillChars?.length);
    if (!lines.length || !hasQuill) {
      ctxs.reply.clearRect(0, 0, w, h);
      setPhase('listening');
      setStatus('继续写。');
      return;
    }

    const start = performance.now();
    const totalChars = Math.max(1, lines.reduce((sum, line) => sum + (line.quillChars?.length || 0), 0));
    const charFadeDuration = Math.max(settings.animation.replyLineFadeMs * 0.5, 900);
    const charDelay = Math.max(90, Math.min(220, settings.animation.replyLineFadeMs / Math.max(totalChars * 0.9, 1)));
    const totalDuration = charFadeDuration + Math.max(0, totalChars - 1) * charDelay;

    const step = () => {
      if (replyGenerationRef.current !== expectedGeneration) {
        // R2 fix: generation expired — clean up reply canvas instead of leaving residue
        ctxs.reply.clearRect(0, 0, w, h);
        replyLinesRef.current = [];
        replyFadeRafRef.current = null;
        return;
      }
      const elapsed = performance.now() - start;
      ctxs.reply.clearRect(0, 0, w, h);
      let charOffset = 0;
      ctxs.reply.save();
      ctxs.reply.strokeStyle = settings.font.inkColor;
      // Keep fade visual weight in sync with the writing pass
      const fadeRefFontSize = Math.max(12, Number(replyFontRef.current?.match(/^(\d+(?:\.\d+)?)px/)?.[1] ?? 24));
      ctxs.reply.lineWidth = clamp(settings.font.strokeWidth * Math.max(0.55, fadeRefFontSize / 28), 0.45, 4.8);
      ctxs.reply.lineCap = 'round';
      ctxs.reply.lineJoin = 'round';
      ctxs.reply.shadowColor = 'rgba(40, 22, 0, .16)';
      ctxs.reply.shadowBlur = settings.font.shadowStrength;
      for (const line of lines) {
        const scale = line.quillScale || 1;
        for (const char of line.quillChars || []) {
          const local = clamp((elapsed - charOffset * charDelay) / charFadeDuration, 0, 1);
          const eased = 1 - Math.pow(1 - local, 2.0);
          const alpha = (1 - eased) * settings.font.inkOpacity;
          if (alpha > 0.01) {
            ctxs.reply.globalAlpha = alpha;
            for (const stroke of char.strokes) drawFullStroke(ctxs.reply, stroke, line.x + char.offsetX * scale, line.y, scale);
          }
          charOffset += 1;
        }
      }
      ctxs.reply.restore();
      if (elapsed < totalDuration) {
        replyFadeRafRef.current = requestAnimationFrame(step);
      } else {
        ctxs.reply.clearRect(0, 0, w, h);
        replyLinesRef.current = [];
        replyFadeRafRef.current = null;
        setPhase('listening');
        setStatus('继续写。');
      }
    };
    replyFadeRafRef.current = requestAnimationFrame(step);
  }

  function handleStrikeStroke(strike: Stroke) {
    const ctxs = ctxsRef.current;
    const strikeBox = bboxForStroke(strike, 6);
    if (!ctxs || !strikeBox) return false;
    const now = performance.now();
    const previous = strikeCandidateRef.current;
    const closeEnough = previous && now - previous.at < 1900 && Math.abs((previous.bbox.y + previous.bbox.h / 2) - (strikeBox.y + strikeBox.h / 2)) < 82 && intersects({ ...previous.bbox, y: previous.bbox.y - 28, h: previous.bbox.h + 56 }, strikeBox);

    if (!closeEnough) {
      strikeCandidateRef.current = { bbox: strikeBox, at: now };
      setStatus('如果是划掉，再划第二道线确认。');
      return false;
    }

    strokesRef.current = strokesRef.current.filter((s) => s !== strike);
    const eraseRegion = strikeEraseRegion(previous.bbox, strikeBox);
    let erasedUserInk = false;
    let erasedReply = false;

    if (settings.input.strikeTargets.includes('user-ink')) {
      const before = strokesRef.current.length;
      strokesRef.current = strokesRef.current.filter((s) => {
        const box = bboxForStroke(s, 8);
        return !box || !intersects(box, eraseRegion);
      });
      erasedUserInk = strokesRef.current.length !== before;
    }

    if (settings.input.strikeTargets.includes('ai-reply')) {
      erasedReply = replyLinesRef.current.some((line) => {
        const box = bboxForReplyLine(line);
        return Boolean(box && intersects(box, eraseRegion));
      });
      if (erasedReply) fadeReply(replyGenerationRef.current);
    }

    strikeCandidateRef.current = null;
    clearIdleTimer();
    redrawStrokes(ctxs.ink, strokesRef.current, sizeRef.current.w, sizeRef.current.h, 1, settings);
    setPhase('listening');
    setStatus(erasedReply && !erasedUserInk ? '这句回信已经划去了。' : '这片墨迹已经划去了。');
    return true;
  }

  useEffect(() => {
    const canvas = inkRef.current;
    const ctxs = ctxsRef.current;
    if (!canvas || !ctxs) return;

    const shouldAcceptPointer = (event: PointerEvent) => {
      if (activePointerIdRef.current !== null && event.pointerId !== activePointerIdRef.current) return false;
      if (event.pointerType === 'touch' && !settings.input.allowTouchWriting) return false;
      if (event.pointerType === 'touch' && event.isPrimary === false) return false;
      return true;
    };

    const onPointerDown = (event: PointerEvent) => {
      event.preventDefault();
      if (!shouldAcceptPointer(event)) return;
      activePointerIdRef.current = event.pointerId;
      clearIdleTimer();
      ++inkGenerationRef.current;
      clearInkTimers();
      if (settings.input.onWriteDuringReply === 'clear-immediately') {
        clearReplyTimers();
        ctxs.reply.clearRect(0, 0, sizeRef.current.w, sizeRef.current.h);
        replyLinesRef.current = [];
      // Keep old reply fading at its own pace while new writing starts; don't interrupt it.
      } else if (settings.input.onWriteDuringReply === 'fade-out' && replyLinesRef.current.length) {
        // no-op: let existing fade continue naturally alongside new ink
      }
      ctxs.effects.clearRect(0, 0, sizeRef.current.w, sizeRef.current.h);
      setPhase('listening');
      setStatus(event.pointerType === 'pen' ? '正在记录笔迹。' : '正在记录触摸笔迹。');
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // Some WebKit edge states can reject pointer capture; drawing can continue without it.
      }
      const stroke: Stroke = { points: [pointerPoint(canvas, event, settings)] };
      currentStrokeRef.current = stroke;
      strokesRef.current.push(stroke);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== activePointerIdRef.current) return;
      const stroke = currentStrokeRef.current;
      if (!stroke) return;
      event.preventDefault();
      const events = event.getCoalescedEvents ? event.getCoalescedEvents() : [event];
      for (const e of events) {
        const p = pointerPoint(canvas, e, settings);
        const last = stroke.points[stroke.points.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) < 0.5) continue;
        stroke.points.push(p);
        drawStrokeSegment(ctxs.ink, last, p, 1, settings);
      }
    };

    const finish = (event: PointerEvent, shouldCommit: boolean) => {
      if (event.pointerId !== activePointerIdRef.current) return;
      const stroke = currentStrokeRef.current;
      if (!stroke) return;
      event.preventDefault();
      currentStrokeRef.current = null;
      activePointerIdRef.current = null;
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch {
        // ignore
      }
      if (!shouldCommit) {
        strokesRef.current = strokesRef.current.filter((s) => s !== stroke);
        redrawStrokes(ctxs.ink, strokesRef.current, sizeRef.current.w, sizeRef.current.h, 1, settings);
        setPhase('listening');
        setStatus('这笔被系统中断了，没有提交。');
        return;
      }
      if (isStrikeStroke(stroke) && handleStrikeStroke(stroke)) return;
      scheduleCommit();
    };

    const onPointerUp = (event: PointerEvent) => finish(event, true);
    const onPointerCancel = (event: PointerEvent) => finish(event, false);

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
    };
  }, [settings]);

  function updateSettings(mutator: (draft: Settings) => void) {
    setSettings((current) => {
      const next = cloneSettings(current) as Settings;
      mutator(next);
      return next;
    });
  }

  function resetSettings() {
    setSettings(createDefaultSettings());
  }

  async function copySettingsJson() {
    const text = JSON.stringify(settings, null, 2);
    try {
      await navigator.clipboard?.writeText(text);
      setStatus('设置 JSON 已复制。');
    } catch {
      window.prompt('复制设置 JSON', text);
    }
  }

  function importSettingsJson() {
    const raw = window.prompt('粘贴设置 JSON');
    if (!raw) return;
    try {
      setSettings(sanitizeSettings(deepMerge(createDefaultSettings(), JSON.parse(raw))));
      setStatus('设置已导入。');
    } catch {
      setStatus('设置 JSON 无法解析。');
    }
  }

  function savePreset() {
    const name = window.prompt('预设名称');
    if (!name) return;
    const presets = JSON.parse(localStorage.getItem(PRESETS_KEY) || '{}');
    presets[name] = settings;
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
    setStatus(`已保存预设：${name}`);
  }

  function loadPreset() {
    const presets = JSON.parse(localStorage.getItem(PRESETS_KEY) || '{}');
    const names = Object.keys(presets);
    const name = window.prompt(`输入要载入的预设：${names.join(' / ')}`);
    if (!name || !presets[name]) return;
    setSettings(sanitizeSettings(deepMerge(createDefaultSettings(), presets[name])));
    setStatus(`已载入预设：${name}`);
  }

  function saveAiEndpoints() {
    const name = window.prompt('接入配置名称');
    if (!name) return;
    const presets = JSON.parse(localStorage.getItem(AI_ENDPOINTS_KEY) || '{}');
    presets[name] = {
      primaryEndpointName: settings.ai.primaryEndpointName,
      baseUrl: settings.ai.baseUrl,
      apiKey: settings.ai.apiKey,
      model: settings.ai.model,
      replyModel: settings.ai.replyModel,
      visionEndpointName: settings.ai.visionEndpointName,
      visionBaseUrl: settings.ai.visionBaseUrl,
      visionApiKey: settings.ai.visionApiKey,
      visionModel: settings.ai.visionModel,
      modelMode: settings.ai.modelMode,
      replyPipeline: settings.ai.replyPipeline,
    };
    localStorage.setItem(AI_ENDPOINTS_KEY, JSON.stringify(presets));
    setStatus(`已保存接入配置：${name}`);
  }

  function loadAiEndpoints() {
    const presets = JSON.parse(localStorage.getItem(AI_ENDPOINTS_KEY) || '{}');
    const names = Object.keys(presets);
    const name = window.prompt(`输入要载入的接入配置：${names.join(' / ')}`);
    if (!name || !presets[name]) return;
    const preset = presets[name];
    updateSettings((d) => {
      d.ai.primaryEndpointName = preset.primaryEndpointName || d.ai.primaryEndpointName;
      d.ai.baseUrl = preset.baseUrl || '';
      d.ai.apiKey = preset.apiKey || '';
      d.ai.model = preset.model || '';
      d.ai.replyModel = preset.replyModel || '';
      d.ai.visionEndpointName = preset.visionEndpointName || d.ai.visionEndpointName;
      d.ai.visionBaseUrl = preset.visionBaseUrl || '';
      d.ai.visionApiKey = preset.visionApiKey || '';
      d.ai.visionModel = preset.visionModel || '';
      d.ai.modelMode = preset.modelMode || d.ai.modelMode;
      d.ai.replyPipeline = preset.replyPipeline || d.ai.replyPipeline;
    });
    setStatus(`已载入接入配置：${name}`);
  }

  async function loadModelOptionsFor(baseUrl: string, apiKey: string, assign: (ids: string[]) => void, label: string) {
    if (!apiKey.trim()) throw new Error(`请先填写${label} API Key。`);
    let res = await fetchWithRetry(aiProxyUrl('models'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl, apiKey }),
    });
    if (res.status === 404 || res.status === 405) {
      const normalizedBase = baseUrl.trim().replace(/\/+$/, '').replace(/\/v1$/, '');
      res = await fetch(`${normalizedBase}/v1/models`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
    }
    if (!res.ok) throw new Error(`${label}模型列表读取失败：HTTP ${res.status}`);
    const data = await res.json();
    const ids = (data?.data || []).map((m: any) => String(m.id || '')).filter(Boolean).sort();
    assign(ids);
    try { localStorage.setItem(modelOptionsCacheKey(baseUrl), JSON.stringify(ids)); } catch { /* ignore */ }
    return ids;
  }

  async function loadModelOptions() {
    try {
      const ids = await loadModelOptionsFor(settings.ai.baseUrl, settings.ai.apiKey, setModelOptions, settings.ai.primaryEndpointName || '主接入');
      setStatus(ids.length ? `已读取主接入 ${ids.length} 个模型。` : '主接入返回了模型列表，但没有可用模型名。');
    } catch (error) {
      const message = error instanceof TypeError
        ? '浏览器无法直连主接入，可能是服务商 CORS 限制；需要换支持浏览器直连的 Base URL，或接线上代理。'
        : error instanceof Error ? error.message : String(error);
      setModelOptions([]);
      setStatus(`读取主接入模型失败：${message.slice(0, 80)}`);
    }
  }

  async function loadVisionModelOptions() {
    try {
      const baseUrl = settings.ai.visionBaseUrl.trim() || settings.ai.baseUrl;
      const apiKey = settings.ai.visionApiKey.trim() || settings.ai.apiKey;
      const ids = await loadModelOptionsFor(baseUrl, apiKey, setVisionModelOptions, settings.ai.visionEndpointName || '补充视觉接入');
      setStatus(ids.length ? `已读取补充视觉接入 ${ids.length} 个模型。` : '补充视觉接入返回了模型列表，但没有可用模型名。');
    } catch (error) {
      const message = error instanceof TypeError
        ? '浏览器无法直连补充视觉接入，可能是服务商 CORS 限制；需要换支持浏览器直连的 Base URL，或接线上代理。'
        : error instanceof Error ? error.message : String(error);
      setVisionModelOptions([]);
      setStatus(`读取补充视觉接入模型失败：${message.slice(0, 80)}`);
    }
  }

  async function testLastCropRecognition() {
    try {
      if (!debugSample?.imageDataUrl) throw new Error('还没有最近一次裁剪图。请先写一句话并停笔。');
      if (!settings.ai.apiKey.trim()) throw new Error('请先填写 密钥 API Key。');
      const model = settings.ai.modelMode === 'split' ? (settings.ai.visionModel || settings.ai.model) : settings.ai.model;
      const recognizedText = await postChatCompletion(model, [
        { role: 'system', content: '你是宽容的手写 OCR。优先尽力读懂整句话的意思，而不是因为一两个字模糊就整句判失败。请只输出你能确认的大部分原文；个别看不清的位置用[看不清]保留。只有当整句几乎都无法辨认时，才只输出“看不清”。' },
        { role: 'user', content: [
          { type: 'text', text: '请尽力转写图片里的手写中文。大部分能看懂就继续输出；只有极少数模糊位置，用[看不清]占位。除手写原文外不要输出别的。' },
          dataUrlToOpenAIImage(debugSample.imageDataUrl),
        ] },
      ], 260, settings.ai.modelMode === 'split' ? { baseUrl: visionProviderBaseUrl(), apiKey: visionProviderApiKey() } : undefined);
      setDebugSample((sample) => ({ ...(sample || {}), recognizedText: normalizeRecognizedText(recognizedText), model, at: new Date().toISOString() }));
      setStatus('最近一次裁剪图识别完成。');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDebugSample((sample) => ({ ...(sample || {}), error: message, at: new Date().toISOString() }));
      setStatus(`裁剪图识别失败：${message.slice(0, 80)}`);
    }
  }

  async function testPersonaReply() {
    try {
      const prompt = '你是谁？';
      const reply = settings.ai.enabled ? await replyFromRecognizedText(prompt) : mockReplyForPersona(settings);
      setDebugSample({ recognizedText: prompt, reply, model: settings.ai.enabled ? settings.ai.model : 'mock-persona', at: new Date().toISOString() });
      setStatus('人格测试完成。');
      startReply(reply);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDebugSample({ recognizedText: '你是谁？', error: message, model: settings.ai.model, at: new Date().toISOString() });
      setStatus(`人格测试失败：${message.slice(0, 80)}`);
    }
  }

  async function testAiConnection() {
    try {
      if (!settings.ai.enabled) throw new Error('请先启用真实 AI 回信。');
      const testCanvas = document.createElement('canvas');
      testCanvas.width = 240;
      testCanvas.height = 80;
      const testCtx = testCanvas.getContext('2d')!;
      testCtx.fillStyle = '#fffaf0';
      testCtx.fillRect(0, 0, 240, 80);
      testCtx.fillStyle = '#1a1208';
      testCtx.font = '24px Kaiti SC, serif';
      testCtx.fillText('测试', 20, 48);
      const testImage = testCanvas.toDataURL('image/png');
      const reply = settings.ai.adapter === 'custom-http' ? await callCustomHttp(testImage) : await callOpenAICompatible(testImage);
      setDebugSample({ imageDataUrl: testImage, reply, model: settings.ai.model, at: new Date().toISOString() });
      setStatus('AI 测试通过。');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDebugSample({ error: message, model: settings.ai.model, at: new Date().toISOString() });
      setStatus(`AI 测试失败：${message.slice(0, 80)}`);
    }
  }

  function toggleSection(id: string) {
    updateSettings((draft) => {
      draft.ui.expandedSections[id] = !draft.ui.expandedSections[id];
    });
  }

  function beginStatusLongPress(event?: React.PointerEvent) {
    event?.preventDefault();
    event?.stopPropagation();
    if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = window.setTimeout(() => setSettingsOpen(true), 700);
  }

  function cancelStatusLongPress(event?: React.PointerEvent) {
    event?.preventDefault();
    event?.stopPropagation();
    if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  }

  function clearConversationHistory() {
    if (!window.confirm('清空历史记录？这只会删除本地历史，不会删除设置里的 API Key。')) return;
    clearHistory();
    setThread('default');
    setHistoryEntries([]);
    setDebugSample(null);
    setStatus('历史记录已清空，当前对话线也已重置。');
  }

  return (
    <main ref={shellRef} className="diary-shell">
      <canvas ref={paperRef} className="layer" aria-hidden="true" />
      <canvas ref={inkRef} className="layer ink-layer" aria-label="魔法日记手写区域" />
      <canvas ref={effectsRef} className="layer" aria-hidden="true" />
      <canvas ref={replyRef} className="layer" aria-hidden="true" />
      {settings.ai.recognitionMode !== 'vision' && (
        <textarea
          ref={scribbleRef}
          className="scribble-input"
          value={scribbleText}
          onChange={(event) => setScribbleText(event.target.value)}
          placeholder="随手写识别区：可用 Apple Pencil 在这里写，iPad 会尽量转成文字。留空则走 AI 看图识别。"
          aria-label="iPad 随手写识别区"
        />
      )}
      <section
        className={`status ${phase}`}
        onPointerDown={beginStatusLongPress}
        onPointerUp={cancelStatusLongPress}
        onPointerCancel={cancelStatusLongPress}
        onPointerLeave={cancelStatusLongPress}
      >
        <span className="dot" />
        <span className="status-text">{status}</span>
      </section>
      <button
        className="settings-trigger"
        type="button"
        aria-label="打开设置"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          setSettingsOpen(true);
        }}
      >⚙</button>
      <button
        className="diagnostics-trigger"
        type="button"
        aria-label="打开诊断模式"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          if (!diagnostics.enabled) setDiagnosticsEnabled(true);
          setSettingsOpen(true);
          setTimeout(() => {
            try {
              document.getElementById('section-diagnostics')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } catch { /* noop */ }
          }, 120);
        }}
        title="诊断模式"
      >🩺</button>
      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          updateSettings={updateSettings}
          resetSettings={resetSettings}
          toggleSection={toggleSection}
          copySettingsJson={copySettingsJson}
          importSettingsJson={importSettingsJson}
          savePreset={savePreset}
          loadPreset={loadPreset}
          loadModelOptions={loadModelOptions}
          loadVisionModelOptions={loadVisionModelOptions}
          saveAiEndpoints={saveAiEndpoints}
          loadAiEndpoints={loadAiEndpoints}
          modelOptions={modelOptions}
          visionModelOptions={visionModelOptions}
          testAiConnection={testAiConnection}
          testLastCropRecognition={testLastCropRecognition}
          testPersonaReply={testPersonaReply}
          debugSample={debugSample}
          diagnostics={diagnostics}
          setDiagnosticsEnabled={(enabled) => { setDiagnosticsEnabled(enabled); refreshDiagnostics(); }}
          copyDiagnosticsJson={copyDiagnosticsJson}
          clearDiagnosticLogs={clearDiagnosticLogs}
          historyEntries={historyEntries}
          activeThreadId={activeThreadId}
          clearConversationHistory={clearConversationHistory}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </main>
  );
}


function Section({ id, title, settings, toggleSection, children }: { id: string; title: string; settings: Settings; toggleSection: (id: string) => void; children: React.ReactNode }) {
  const open = settings.ui.expandedSections[id] ?? true;
  return (
    <section className="settings-section" id={`section-${id}`} data-section-id={id}>
      <button className="section-title" type="button" onClick={() => toggleSection(id)}>
        <span>{title}</span>
        <span>{open ? '收起' : '展开'}</span>
      </button>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function ModelPicker({ label, value, options, fallback, allowEmpty = false, onChange }: { label: string; value: string; options: string[]; fallback: string; allowEmpty?: boolean; onChange: (value: string) => void }) {
  const normalized = Array.from(new Set([...(value && !options.includes(value) ? [value] : []), ...options]));
  return (
    <Field label={label}>
      {normalized.length > 0 ? (
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          {allowEmpty && <option value="">留空：使用默认模型</option>}
          {normalized.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
      ) : (
        <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={fallback} />
      )}
    </Field>
  );
}

function SettingsPanel({ settings, updateSettings, resetSettings, toggleSection, copySettingsJson, importSettingsJson, savePreset, loadPreset, loadModelOptions, loadVisionModelOptions, saveAiEndpoints, loadAiEndpoints, modelOptions, visionModelOptions, testAiConnection, testLastCropRecognition, testPersonaReply, debugSample, diagnostics, setDiagnosticsEnabled, copyDiagnosticsJson, clearDiagnosticLogs, historyEntries, activeThreadId, clearConversationHistory, onClose }: { settings: Settings; updateSettings: (mutator: (draft: Settings) => void) => void; resetSettings: () => void; toggleSection: (id: string) => void; copySettingsJson: () => void; importSettingsJson: () => void; savePreset: () => void; loadPreset: () => void; loadModelOptions: () => void; loadVisionModelOptions: () => void; saveAiEndpoints: () => void; loadAiEndpoints: () => void; modelOptions: string[]; visionModelOptions: string[]; testAiConnection: () => void; testLastCropRecognition: () => void; testPersonaReply: () => void; debugSample: DebugSample | null; diagnostics: DiagnosticsState; setDiagnosticsEnabled: (enabled: boolean) => void; copyDiagnosticsJson: () => void; clearDiagnosticLogs: () => void; historyEntries: HistoryEntry[]; activeThreadId: string; clearConversationHistory: () => void; onClose: () => void }) {
  return (
    <div
      className="settings-overlay"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onClose}
    >
      <aside
        className="settings-panel"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <div>
            <h2>设置</h2>
            <p>V1 · 本地体验调参</p>
          </div>
          <button type="button" onClick={onClose}>关闭</button>
        </header>

        <Section id="ai" title="AI 接入" settings={settings} toggleSection={toggleSection}>
          <div className="check-row">
            <label><input type="checkbox" checked={settings.ai.enabled} onChange={(e) => updateSettings((d) => { d.ai.enabled = e.target.checked; })} /> 启用真实 AI 回信</label>
          </div>
          <Field label="接口类型">
            <select value={settings.ai.adapter} onChange={(e) => updateSettings((d) => { d.ai.adapter = e.target.value as Settings['ai']['adapter']; })}>
              <option value="openai-compatible">OpenAI 兼容接口</option>
              <option value="custom-http">自定义 HTTP</option>
            </select>
          </Field>
          <Field label="主接入名称"><input value={settings.ai.primaryEndpointName} onChange={(e) => updateSettings((d) => { d.ai.primaryEndpointName = e.target.value; })} placeholder="例如：主接入" /></Field>
          <Field label="主接入 Base URL"><input value={settings.ai.baseUrl} onChange={(e) => updateSettings((d) => { d.ai.baseUrl = e.target.value; })} placeholder="https://api.openai.com" /></Field>
          <Field label="主接入 API Key"><input type="password" value={settings.ai.apiKey} onChange={(e) => updateSettings((d) => { d.ai.apiKey = e.target.value; })} placeholder="仅保存在当前浏览器" /></Field>
          <Field label="补充视觉接入名称"><input value={settings.ai.visionEndpointName} onChange={(e) => updateSettings((d) => { d.ai.visionEndpointName = e.target.value; })} placeholder="例如：视觉补充接入" /></Field>
          <Field label="补充视觉接入 Base URL"><input value={settings.ai.visionBaseUrl} onChange={(e) => updateSettings((d) => { d.ai.visionBaseUrl = e.target.value; })} placeholder="留空：沿用主接入" /></Field>
          <Field label="补充视觉接入 API Key"><input type="password" value={settings.ai.visionApiKey} onChange={(e) => updateSettings((d) => { d.ai.visionApiKey = e.target.value; })} placeholder="留空：沿用主接入" /></Field>
          <div className="settings-actions inline-actions">
            <button type="button" onClick={loadModelOptions}>读取主接入模型</button>
            <button type="button" onClick={loadVisionModelOptions}>读取补充视觉模型</button>
            <button type="button" onClick={saveAiEndpoints}>保存接入</button>
            <button type="button" onClick={loadAiEndpoints}>载入接入</button>
          </div>
          {modelOptions.length > 0 || visionModelOptions.length > 0
            ? <p className="hint-text">主接入模型 {modelOptions.length} 个；补充视觉模型 {visionModelOptions.length} 个。下面会分别用于主回复模型和补充视觉模型选择。</p>
            : <p className="hint-text">还没读取模型时可手动填；读取后会变成下拉选择。主接入和补充视觉接入可以分别读取。</p>}
          <Field label="识别方式">
            <select value={settings.ai.recognitionMode} onChange={(e) => updateSettings((d) => { d.ai.recognitionMode = e.target.value as Settings['ai']['recognitionMode']; })}>
              <option value="vision">魔法纸模式：Canvas 墨迹 + AI 看图</option>
              <option value="scribble-first">随手写识别模式：隐形纸面输入层 + iPad 转文字</option>
              <option value="scribble-only">纯随手写模式：只用 iPad 转文字</option>
            </select>
          </Field>
          <Field label="回信链路">
            <select value={settings.ai.replyPipeline} onChange={(e) => updateSettings((d) => { d.ai.replyPipeline = e.target.value as Settings['ai']['replyPipeline']; })}>
              <option value="stable">稳定两段式：先识字，再回信</option>
              <option value="fast-single">快速单请求：图片直接回信</option>
            </select>
          </Field>
          <Field label="模型分工方式">
            <select value={settings.ai.modelMode} onChange={(e) => updateSettings((d) => { d.ai.modelMode = e.target.value as Settings['ai']['modelMode']; })}>
              <option value="single">单模型：识字 + 回信都用主模型</option>
              <option value="split">分工模式：补充视觉模型识字，主回复模型回信</option>
            </select>
          </Field>
          <p className="hint-text">如果主模型没有视觉识别能力，就用这里的“分工模式”：让补充视觉模型先读图识字，再由主回复模型负责真正回信。</p>
          <ModelPicker label="主回复模型" value={settings.ai.model} options={modelOptions} fallback="gpt-4o-mini" onChange={(value) => updateSettings((d) => { d.ai.model = value; })} />
          <ModelPicker label="补充视觉模型（先识字）" value={settings.ai.visionModel} options={modelOptions} fallback="可留空使用主回复模型" allowEmpty onChange={(value) => updateSettings((d) => { d.ai.visionModel = value; })} />
          <ModelPicker label="补充回复模型（可留空）" value={settings.ai.replyModel} options={modelOptions} fallback="留空：使用主回复模型" allowEmpty onChange={(value) => updateSettings((d) => { d.ai.replyModel = value; })} />
          <Field label={`创造性 ${settings.ai.temperature.toFixed(2)}`}><input type="range" min="0" max="2" step="0.05" value={settings.ai.temperature} onChange={(e) => updateSettings((d) => { d.ai.temperature = Number(e.target.value); })} /></Field>
          <Field label={`最大输出 ${settings.ai.maxTokens}`}><input type="range" min="80" max="4000" step="20" value={settings.ai.maxTokens} onChange={(e) => updateSettings((d) => { d.ai.maxTokens = Number(e.target.value); })} /></Field>
          <Field label={`裁剪留白 ${settings.ai.visionImage.padding}px`}><input type="range" min="0" max="160" value={settings.ai.visionImage.padding} onChange={(e) => updateSettings((d) => { d.ai.visionImage.padding = Number(e.target.value); })} /></Field>
          <Field label={`图片尺寸上限 ${settings.ai.visionImage.maxSize}px`}><input type="range" min="256" max="2048" step="64" value={settings.ai.visionImage.maxSize} onChange={(e) => updateSettings((d) => { d.ai.visionImage.maxSize = Number(e.target.value); })} /></Field>
          <Field label="识别图片格式">
            <select value={settings.ai.visionImage.format} onChange={(e) => updateSettings((d) => { d.ai.visionImage.format = e.target.value as Settings['ai']['visionImage']['format']; })}>
              <option value="image/webp">WebP：更小更快</option>
              <option value="image/png">PNG：兼容但更大</option>
            </select>
          </Field>
          <Field label="识别图片背景">
            <select value={settings.ai.visionImage.background} onChange={(e) => updateSettings((d) => { d.ai.visionImage.background = e.target.value as Settings['ai']['visionImage']['background']; })}>
              <option value="white">白底</option>
              <option value="transparent">透明</option>
              <option value="paper">纸色</option>
            </select>
          </Field>
          <Field label="自定义接口地址"><input value={settings.ai.customEndpoint} onChange={(e) => updateSettings((d) => { d.ai.customEndpoint = e.target.value; })} placeholder="实验功能" /></Field>
          <Field label="自定义请求体"><textarea value={settings.ai.customBody} onChange={(e) => updateSettings((d) => { d.ai.customBody = e.target.value; })} placeholder="可用 {{imageDataUrl}} {{systemPrompt}} {{model}}" /></Field>
          <div className="settings-actions inline-actions">
            <button type="button" onClick={testAiConnection}>测试 AI 连接</button>
            <button type="button" onClick={testLastCropRecognition}>识别最近裁剪图</button>
          </div>
          {debugSample && <div className="debug-sample">
            {debugSample.imageDataUrl && <img className="debug-image" src={debugSample.imageDataUrl} alt="最近一次传给 AI 的裁剪墨迹图" />}
            <pre className="debug-box">{JSON.stringify({ 时间: debugSample.at, 模型: debugSample.model, 识别文字: debugSample.recognizedText, 回信: debugSample.reply, 错误: debugSample.error, 耗时: debugSample.timings }, null, 2)}</pre>
          </div>}
        </Section>

        <Section id="persona" title="AI 人格 / 回信风格" settings={settings} toggleSection={toggleSection}>
          <Field label="人格预设">
            <select value={settings.persona.presetId} onChange={(e) => updateSettings((d) => { applyPersonaDefaults(d, e.target.value); })}>
              <option value="quiet-friend">安静朋友（默认）</option>
              <option value="calm-mentor">冷静导师</option>
              <option value="old-paper-reply">旧纸回信</option>
              <option value="cultivation-note">修行札记</option>
              <option value="dream-oracle">梦境占卜</option>
              <option value="riddle-diary">里德尔式魔法日记</option>
              <option value="none">无：直接 AI 回复</option>
              <option value="custom">自定义</option>
            </select>
          </Field>
          <div className="debug-sample">
            <pre className="debug-box">{personaPromptExplanation(settings)}</pre>
          </div>
          <p className="hint-text">这是人类可读的解释卡：你现在选的人格会怎么回、用什么长度、什么方式、什么语气，以及它会遵守哪些边界。</p>
          <Field label="回复长度">
            <select value={settings.persona.replyLength} onChange={(e) => updateSettings((d) => { d.persona.replyLength = e.target.value as Settings['persona']['replyLength']; })}>
              <option value="very-short">极短</option>
              <option value="short">短</option>
              <option value="standard">标准</option>
              <option value="detailed">详细</option>
            </select>
          </Field>
          <Field label="回复模式">
            <select value={settings.persona.replyMode} onChange={(e) => updateSettings((d) => { d.persona.replyMode = e.target.value as Settings['persona']['replyMode']; })}>
              <option value="reflective">理解后回应</option>
              <option value="answer">提问时直接回答</option>
              <option value="coach">给一个下一步</option>
              <option value="oracle">象征式纸页回信</option>
              <option value="companion">陪伴理解</option>
            </select>
          </Field>
          <Field label="语气">
            <select value={settings.persona.tone} onChange={(e) => updateSettings((d) => { d.persona.tone = e.target.value as Settings['persona']['tone']; })}>
              <option value="warm">温柔</option>
              <option value="calm">冷静</option>
              <option value="mysterious">神秘</option>
              <option value="direct">直白</option>
              <option value="encouraging">鼓励</option>
            </select>
          </Field>
          <div className="check-row">
            <label><input type="checkbox" checked={settings.persona.useCustomPrompt} onChange={(e) => updateSettings((d) => { d.persona.useCustomPrompt = e.target.checked; })} /> 启用额外自定义要求</label>
          </div>
          <Field label="额外自定义要求">
            <textarea value={settings.persona.customSystemPrompt} onChange={(e) => updateSettings((d) => { d.persona.customSystemPrompt = e.target.value; })} placeholder="例如：更像一本古老日记，但不要太阴森，优先接住上文。" />
          </Field>
          <Field label="禁止事项 / 负面要求">
            <textarea value={settings.persona.negativePrompt} onChange={(e) => updateSettings((d) => { d.persona.negativePrompt = e.target.value; })} />
          </Field>
          <Field label="回应规则预览（实际 system prompt）">
            <textarea readOnly value={personaPrompt(settings)} />
          </Field>
          <Field label="连续对话参考（当前线程最近上下文摘要）">
            <textarea readOnly value={historyEntries.filter((entry) => (entry.threadId || 'default') === activeThreadId).slice(-6).map((entry) => `${entry.inputText ? `用户：${entry.inputText}\n` : ''}日记：${entry.reply}`).join('\n\n') || '当前线程还没有历史内容。'} />
          </Field>
          <div className="settings-actions inline-actions">
            <button type="button" onClick={testPersonaReply}>测试当前人格</button>
          </div>
          {debugSample && (debugSample.recognizedText || debugSample.reply || debugSample.error) && <div className="debug-sample">
            <pre className="debug-box">{JSON.stringify({ 当前人格: settings.persona.presetId, 测试输入: debugSample.recognizedText, 回信: debugSample.reply, 错误: debugSample.error, 模型: debugSample.model, 时间: debugSample.at }, null, 2)}</pre>
          </div>}
        </Section>

        <Section id="history" title={`历史对话记录（${historyEntries.length}）`} settings={settings} toggleSection={toggleSection}>
          <p className="hint-text">历史是本机浏览器明文保存：只保存文字、模型和人格，不保存手写截图和 API Key。注意：API Key 仍会保存在“设置”里，清空历史不会删除它。最多保留最近 50 条，超长文本会自动截断。</p>
          <div className="settings-actions inline-actions">
            <button type="button" onClick={clearConversationHistory}>清空历史</button>
          </div>
          {historyEntries.length === 0 ? <p className="hint-text">还没有历史记录。</p> : (
            <div className="history-list">
              {[...historyEntries].reverse().map((entry) => (
                <article className="history-entry" key={entry.id}>
                  <div className="history-meta">{new Date(entry.at).toLocaleString()} · {entry.persona || 'unknown'} · {entry.replyLength || '默认'} · {entry.model || 'mock'}</div>
                  {entry.inputText && <p className="history-input">你写：{entry.inputText}</p>}
                  <p className="history-reply">回信：{entry.reply}</p>
                </article>
              ))}
            </div>
          )}
        </Section>

        <Section id="diagnostics" title={`诊断模式${diagnostics.enabled ? '（已开启）' : ''}`} settings={settings} toggleSection={toggleSection}>
          <div className="check-row">
            <label><input type="checkbox" checked={diagnostics.enabled} onChange={(e) => setDiagnosticsEnabled(e.target.checked)} /> 开启诊断模式</label>
          </div>
          <p className="hint-text">开启后会记录最近错误、Promise 异常、阶段切换等关键事件，方便排查黑屏、回信异常、OCR 失败。不保存 API Key。</p>
          <div className="settings-actions inline-actions">
            <button type="button" onClick={copyDiagnosticsJson}>复制诊断信息</button>
            <button type="button" onClick={clearDiagnosticLogs}>清空诊断</button>
          </div>
          <div className="debug-sample">
            <pre className="debug-box">{JSON.stringify({ 已开启: diagnostics.enabled, 最近错误: diagnostics.lastError, 最近事件: diagnostics.events.slice(-12) }, null, 2)}</pre>
          </div>
        </Section>

        <Section id="font" title="字体与文字" settings={settings} toggleSection={toggleSection}>
          <Field label="字体">
            <select value={settings.font.selectedFontId} onChange={(e) => updateSettings((d) => { d.font.selectedFontId = e.target.value; })}>
              {FONT_OPTIONS.map((font) => <option key={font.id} value={font.id}>{font.name}</option>)}
            </select>
          </Field>
          <Field label="字号档位">
            <select value={settings.font.sizePreset} onChange={(e) => updateSettings((d) => { d.font.sizePreset = e.target.value as Settings['font']['sizePreset']; })}>
              <option value="small">小</option><option value="medium">中</option><option value="large">大</option><option value="custom">自定义</option>
            </select>
          </Field>
          <Field label={`字号 ${settings.font.fontSizePx}px`}><input type="range" min="16" max="96" value={settings.font.fontSizePx} onChange={(e) => updateSettings((d) => { d.font.fontSizePx = Number(e.target.value); d.font.sizePreset = 'custom'; })} /></Field>
          <Field label={`行距 ${settings.font.lineHeight.toFixed(2)}`}><input type="range" min="1.1" max="2.2" step="0.05" value={settings.font.lineHeight} onChange={(e) => updateSettings((d) => { d.font.lineHeight = Number(e.target.value); })} /></Field>
          <Field label="墨色"><input type="color" value={settings.font.inkColor} onChange={(e) => updateSettings((d) => { d.font.inkColor = e.target.value; })} /></Field>
          <Field label={`墨色透明 ${settings.font.inkOpacity.toFixed(2)}`}><input type="range" min="0.2" max="1" step="0.05" value={settings.font.inkOpacity} onChange={(e) => updateSettings((d) => { d.font.inkOpacity = Number(e.target.value); })} /></Field>
          <Field label={`回信笔粗细 ${settings.font.strokeWidth.toFixed(2)}`}><input type="range" min="1.2" max="4.8" step="0.1" value={settings.font.strokeWidth} onChange={(e) => updateSettings((d) => { d.font.strokeWidth = Number(e.target.value); })} /></Field>
          <Field label={`阴影 ${settings.font.shadowStrength.toFixed(1)}`}><input type="range" min="0" max="8" step="0.2" value={settings.font.shadowStrength} onChange={(e) => updateSettings((d) => { d.font.shadowStrength = Number(e.target.value); })} /></Field>
          <Field label={`最大行宽 ${settings.font.maxWidth}px`}><input type="range" min="280" max="900" value={settings.font.maxWidth} onChange={(e) => updateSettings((d) => { d.font.maxWidth = Number(e.target.value); })} /></Field>
        </Section>

        <Section id="animation" title="动画效果" settings={settings} toggleSection={toggleSection}>
          <p className="hint-text">这里主要控制三段：用户手写墨迹怎么退场、AI 回信怎么写出来、AI 回信停留多久后再淡掉。最近为了接近官方效果，部分动画会按笔画长度自动延长，所以不是每个滑轨都线性生效。</p>
          <Field label="动画速度">
            <select value={settings.animation.speedPreset} onChange={(e) => updateSettings((d) => { const v = e.target.value as Settings['animation']['speedPreset']; d.animation.speedPreset = v; if (v === 'fast') { d.animation.handwritingFadeMs = 800; d.animation.replyFadeInMs = 650; } else if (v === 'standard') { d.animation.handwritingFadeMs = 1100; d.animation.replyFadeInMs = 1000; } else if (v === 'slow') { d.animation.handwritingFadeMs = 1600; d.animation.replyFadeInMs = 1800; } })}>
              <option value="fast">快</option><option value="standard">标准</option><option value="slow">慢</option><option value="custom">自定义</option>
            </select>
          </Field>
          <Field label={`手写消失 ${settings.animation.handwritingFadeMs}ms（用户写的墨迹被纸吸走的速度）`}><input type="range" min="450" max="2500" step="50" value={settings.animation.handwritingFadeMs} onChange={(e) => updateSettings((d) => { d.animation.handwritingFadeMs = Number(e.target.value); d.animation.speedPreset = 'custom'; })} /></Field>
          <Field label={`回复淡入 ${settings.animation.replyFadeInMs}ms（AI 回信开始写出的最短时长；长句会按笔画自动更久）`}><input type="range" min="400" max="4200" step="50" value={settings.animation.replyFadeInMs} onChange={(e) => updateSettings((d) => { d.animation.replyFadeInMs = Number(e.target.value); d.animation.speedPreset = 'custom'; })} /></Field>
          <Field label={`停留最短 ${settings.animation.replyLingerMinMs}ms（回信写完后至少停多久）`}><input type="range" min="200" max="9000" step="50" value={settings.animation.replyLingerMinMs} onChange={(e) => updateSettings((d) => { d.animation.replyLingerMinMs = Number(e.target.value); })} /></Field>
          <Field label={`停留最长 ${settings.animation.replyLingerMaxMs}ms（长回复最多停多久）`}><input type="range" min="600" max="12000" step="50" value={settings.animation.replyLingerMaxMs} onChange={(e) => updateSettings((d) => { d.animation.replyLingerMaxMs = Number(e.target.value); })} /></Field>
          <Field label={`每行停留增量 ${settings.animation.replyLingerPerLineMs}ms（回信每多一行额外多停一会）`}><input type="range" min="0" max="1600" step="20" value={settings.animation.replyLingerPerLineMs} onChange={(e) => updateSettings((d) => { d.animation.replyLingerPerLineMs = Number(e.target.value); })} /></Field>
          <Field label={`行淡出 ${settings.animation.replyLineFadeMs}ms（每个字自己淡掉的时长）`}><input type="range" min="500" max="5000" step="50" value={settings.animation.replyLineFadeMs} onChange={(e) => updateSettings((d) => { d.animation.replyLineFadeMs = Number(e.target.value); })} /></Field>
          <p className="hint-text">已隐藏旧的兼容参数（例如行间延迟、整体淡出阈值）。当前主要就是上面这 5 个参数在决定你实际看到的效果。</p>
        </Section>

        <Section id="input" title="手写输入" settings={settings} toggleSection={toggleSection}>
          <Field label="停笔触发">
            <select value={settings.input.idlePreset} onChange={(e) => updateSettings((d) => { const v = e.target.value as Settings['input']['idlePreset']; d.input.idlePreset = v; d.input.idleCommitMs = v === 'fast' ? 900 : v === 'slow' ? 2800 : v === 'standard' ? 1600 : d.input.idleCommitMs; })}>
              <option value="fast">快</option><option value="standard">标准</option><option value="slow">慢</option><option value="custom">自定义</option>
            </select>
          </Field>
          <Field label={`停笔 ${settings.input.idleCommitMs}ms`}><input type="range" min="700" max="6000" step="100" value={settings.input.idleCommitMs} onChange={(e) => updateSettings((d) => { d.input.idleCommitMs = Number(e.target.value); d.input.idlePreset = 'custom'; })} /></Field>
          <Field label="写入时 AI 回复">
            <select value={settings.input.onWriteDuringReply} onChange={(e) => updateSettings((d) => { d.input.onWriteDuringReply = e.target.value as Settings['input']['onWriteDuringReply']; })}>
              <option value="clear-immediately">立即清除</option><option value="fade-out">自然淡出</option><option value="keep">保留</option>
            </select>
          </Field>
          <div className="check-row">
            <label><input type="checkbox" checked={settings.input.strikeTargets.includes('user-ink')} onChange={(e) => updateSettings((d) => { d.input.strikeTargets = e.target.checked ? Array.from(new Set([...d.input.strikeTargets, 'user-ink'])) : d.input.strikeTargets.filter((v) => v !== 'user-ink'); })} /> 划掉用户字迹</label>
            <label><input type="checkbox" checked={settings.input.strikeTargets.includes('ai-reply')} onChange={(e) => updateSettings((d) => { d.input.strikeTargets = e.target.checked ? Array.from(new Set([...d.input.strikeTargets, 'ai-reply'])) : d.input.strikeTargets.filter((v) => v !== 'ai-reply'); })} /> 划掉 AI 回信</label>
          </div>
          <div className="check-row">
            <label><input type="checkbox" checked={settings.input.allowTouchWriting} onChange={(e) => updateSettings((d) => { d.input.allowTouchWriting = e.target.checked; })} /> 允许手指书写</label>
          </div>
          <p className="hint-text">关闭后会忽略手指/手掌触摸，只接受 Apple Pencil 或触控笔。</p>
          <Field label={`手指压力 ${settings.input.touchPressure.toFixed(2)}`}><input type="range" min="0.3" max="1" step="0.05" value={settings.input.touchPressure} onChange={(e) => updateSettings((d) => { d.input.touchPressure = Number(e.target.value); })} /></Field>
          <Field label={`基础笔宽 ${settings.input.penBaseWidth.toFixed(1)}`}><input type="range" min="1" max="4" step="0.1" value={settings.input.penBaseWidth} onChange={(e) => updateSettings((d) => { d.input.penBaseWidth = Number(e.target.value); })} /></Field>
        </Section>

        <Section id="reply" title="回信位置" settings={settings} toggleSection={toggleSection}>
          <Field label="回信出现位置">
            <select value={settings.reply.positionMode} onChange={(e) => updateSettings((d) => { d.reply.positionMode = e.target.value as ReplyPositionMode; })}>
              <option value="auto">自动：优先靠近书写区域</option>
              <option value="fixed-center">固定中部</option>
              <option value="follow-writing">跟随书写</option>
            </select>
          </Field>
        </Section>

        <Section id="paper" title="纸张背景" settings={settings} toggleSection={toggleSection}>
          <Field label="适应方式"><select value={settings.paper.fit} onChange={(e) => updateSettings((d) => { d.paper.fit = e.target.value as Settings['paper']['fit']; })}><option value="cover">cover</option><option value="contain">contain</option><option value="repeat">repeat</option><option value="stretch">stretch</option></select></Field>
          <Field label="位置"><select value={settings.paper.position} onChange={(e) => updateSettings((d) => { d.paper.position = e.target.value as Settings['paper']['position']; })}><option value="center">center</option><option value="top">top</option><option value="bottom">bottom</option></select></Field>
          <Field label={`亮度 ${settings.paper.brightness.toFixed(2)}`}><input type="range" min="0.6" max="1.4" step="0.02" value={settings.paper.brightness} onChange={(e) => updateSettings((d) => { d.paper.brightness = Number(e.target.value); })} /></Field>
          <Field label={`对比 ${settings.paper.contrast.toFixed(2)}`}><input type="range" min="0.6" max="1.6" step="0.02" value={settings.paper.contrast} onChange={(e) => updateSettings((d) => { d.paper.contrast = Number(e.target.value); })} /></Field>
          <Field label={`暗角 ${settings.paper.vignette.toFixed(2)}`}><input type="range" min="0" max="0.7" step="0.02" value={settings.paper.vignette} onChange={(e) => updateSettings((d) => { d.paper.vignette = Number(e.target.value); })} /></Field>
        </Section>

        <section className="settings-actions">
          <button type="button" onClick={resetSettings}>恢复默认</button>
          <button type="button" onClick={copySettingsJson}>复制设置 JSON</button>
          <button type="button" onClick={importSettingsJson}>导入 JSON</button>
          <button type="button" onClick={savePreset}>保存预设</button>
          <button type="button" onClick={loadPreset}>载入预设</button>
        </section>
      </aside>
    </div>
  );
}

class ErrorBoundary extends Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    try {
      const existing = localStorage.getItem('magic-diary-diagnostics-v1');
      const parsed = existing ? JSON.parse(existing) : { events: [], lastError: null, enabled: true };
      parsed.lastError = { at: new Date().toISOString(), message: error.message || 'unknown' };
      parsed.events = [...(parsed.events || []), { at: new Date().toISOString(), kind: 'react-error', detail: `${error.message || 'unknown'} | ${(info.componentStack || '').slice(0, 200)}` }].slice(-60);
      localStorage.setItem('magic-diary-diagnostics-v1', JSON.stringify(parsed));
    } catch {
      // ignore storage failures
    }
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '24px', fontFamily: 'system-ui, sans-serif', color: '#2d1b0d', background: '#ead9b6', minHeight: '100vh' }}>
          <h2>页面出错了</h2>
          <p>错误信息：{this.state.error.message}</p>
          <p>已记录到诊断模式。重新打开设置 → 诊断模式 可复制调试信息发给我。</p>
          <button type="button" onClick={() => location.reload()} style={{ marginTop: '12px', padding: '8px 16px' }}>刷新重试</button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
