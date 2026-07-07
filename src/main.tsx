import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { computeReplyPosition, type ReplyPositionMode } from './replyPosition';
import './styles.css';

type Point = { x: number; y: number; pressure: number; t: number };
type Stroke = { points: Point[] };
type StrikeCandidate = { bbox: BBox; at: number };
type ReplyLine = { text: string; x: number; y: number; width: number; canvas?: HTMLCanvasElement };
type Phase = 'listening' | 'pending' | 'drinking' | 'thinking' | 'replying' | 'lingering';

type BBox = { x: number; y: number; w: number; h: number };

const MOCK_REPLY = '墨迹已经告诉我了。你不是想要一个立刻响亮的答案，而是想确认这条路能不能走。先把能验证的那一步写下来，别急着把整座城都画完。纸会记住你留下的每一道痕迹，也会慢慢抹去那些不必再背着的念头。';
const ASSET_BASE = import.meta.env.BASE_URL || '/';
const PAPER_TEXTURE_SRC = `${ASSET_BASE}assets/parchment-texture.png`;

const paperTexture = new Image();
paperTexture.src = PAPER_TEXTURE_SRC;


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
const MODEL_OPTIONS_KEY = 'magic-diary-model-options-v1';
function modelOptionsCacheKey(baseUrl: string) {
  return `${MODEL_OPTIONS_KEY}:${(baseUrl || '').trim().replace(/\/+$/, '') || 'default'}`;
}

const FONT_OPTIONS: FontOption[] = [
  { id: 'xindi-xiawucha', name: '新蒂下午茶白金版', family: 'DiaryHandwriting, DiaryHandwritingFull' },
  { id: 'xindi-paoti', name: '新蒂泡体', family: 'XinDiPaoTi' },
  { id: 'system-kaiti', name: '系统楷体', family: 'Kaiti SC, STKaiti, serif' },
];

function createDefaultSettings(): Settings {
  return {
  schemaVersion: 3,
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
    modelMode: 'single',
    recognitionMode: 'vision',
    replyPipeline: 'fast-single',
    model: 'gpt-4o-mini',
    visionModel: '',
    replyModel: '',
    temperature: 0.7,
    maxTokens: 360,
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
    shadowStrength: 1.2,
    maxWidth: 720,
  },
  animation: {
    speedPreset: 'slow',
    handwritingFadeMs: 1600,
    replyFadeInMs: 1800,
    replyLingerMinMs: 950,
    replyLingerMaxMs: 2200,
    replyLingerPerLineMs: 260,
    replyLineFadeMs: 1450,
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
    presetId: 'riddle-diary',
    replyLength: 'very-short',
    replyMode: 'oracle',
    tone: 'mysterious',
    useCustomPrompt: false,
    customSystemPrompt: '',
    negativePrompt: '不要自称 AI。不要长篇说教。不要使用网络热词。不要编造用户没有写下的事实。',
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
  clean.schemaVersion = 3;
  clean.ai.enabled = Boolean(clean.ai.enabled);
  clean.ai.adapter = oneOf(clean.ai.adapter, ['openai-compatible', 'custom-http'] as const, 'openai-compatible');
  clean.ai.modelMode = oneOf(clean.ai.modelMode, ['single', 'split'] as const, 'single');
  clean.ai.recognitionMode = oneOf(clean.ai.recognitionMode, ['vision', 'scribble-first', 'scribble-only'] as const, 'vision');
  clean.ai.replyPipeline = oneOf(clean.ai.replyPipeline, ['stable', 'fast-single'] as const, 'stable');
  clean.ai.temperature = clamp(Number(clean.ai.temperature) || 0.7, 0, 2);
  clean.ai.maxTokens = clamp(Number(clean.ai.maxTokens) || 360, 80, 4000);
  clean.ai.timeoutMs = clamp(Number(clean.ai.timeoutMs) || 45000, 5000, 120000);
  clean.ai.visionImage.padding = clamp(Number(clean.ai.visionImage.padding) || 32, 0, 160);
  clean.ai.visionImage.maxSize = clamp(Number(clean.ai.visionImage.maxSize) || 768, 256, 2048);
  clean.ai.visionImage.background = oneOf(clean.ai.visionImage.background, ['white', 'transparent', 'paper'] as const, 'white');
  clean.ai.visionImage.format = oneOf(clean.ai.visionImage.format, ['image/png', 'image/webp'] as const, 'image/webp');
  clean.font.selectedFontId = FONT_OPTIONS.some((font) => font.id === clean.font.selectedFontId) ? clean.font.selectedFontId : 'xindi-xiawucha';
  clean.font.sizePreset = oneOf(clean.font.sizePreset, ['small', 'medium', 'large', 'custom'] as const, 'medium');
  clean.font.fontSizePx = clamp(Number(clean.font.fontSizePx) || 24, 16, 96);
  clean.font.lineHeight = clamp(Number(clean.font.lineHeight) || 1.65, 1.1, 2.2);
  clean.font.inkOpacity = clamp(Number(clean.font.inkOpacity) || 1, 0.2, 1);
  clean.font.shadowStrength = clamp(Number(clean.font.shadowStrength) || 1.2, 0, 8);
  clean.font.maxWidth = clamp(Number(clean.font.maxWidth) || 720, 280, 900);
  clean.animation.speedPreset = oneOf(clean.animation.speedPreset, ['slow', 'standard', 'fast', 'custom'] as const, 'standard');
  clean.animation.handwritingFadeMs = clamp(Number(clean.animation.handwritingFadeMs) || 1100, 450, 2500);
  clean.animation.replyFadeInMs = clamp(Number(clean.animation.replyFadeInMs) || 1000, 400, 4200);
  if (clean.animation.speedPreset === 'fast') { clean.animation.handwritingFadeMs = 800; clean.animation.replyFadeInMs = 650; }
  if (clean.animation.speedPreset === 'standard') { clean.animation.handwritingFadeMs = 1100; clean.animation.replyFadeInMs = 1000; }
  if (clean.animation.speedPreset === 'slow') { clean.animation.handwritingFadeMs = 1600; clean.animation.replyFadeInMs = 1800; }
  clean.animation.replyLingerMinMs = clamp(Number(clean.animation.replyLingerMinMs) || 950, 200, 4000);
  clean.animation.replyLingerMaxMs = clamp(Number(clean.animation.replyLingerMaxMs) || 2200, clean.animation.replyLingerMinMs, 8000);
  clean.animation.replyLingerPerLineMs = clamp(Number(clean.animation.replyLingerPerLineMs) || 260, 0, 1600);
  clean.animation.replyLineFadeMs = clamp(Number(clean.animation.replyLineFadeMs) || 1450, 500, 3500);
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
  clean.persona.presetId = oneOf(clean.persona.presetId, ['old-paper-reply', 'riddle-diary', 'quiet-friend', 'calm-mentor', 'cultivation-note', 'dream-oracle', 'custom'] as const, 'old-paper-reply');
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
  if (settings.persona.presetId === 'riddle-diary') return '我是留在这本日记里的一个名字。先写下你的名字，我会告诉你我知道什么。';
  if (settings.persona.presetId === 'quiet-friend') return '我听见了。先不用急着解释，能写下来就已经往前走了一步。';
  if (settings.persona.presetId === 'calm-mentor') return '先做最小的一步验证。把下一步写清楚，再决定要不要继续。';
  if (settings.persona.presetId === 'dream-oracle') return '墨迹像雾一样停在纸上。答案不远，只是还没有完全显形。';
  return MOCK_REPLY;
}

function personaPrompt(settings: Settings) {
  const preset = settings.persona.presetId === 'quiet-friend' ? '你像一位安静可靠的朋友，少说教，多陪伴。'
    : settings.persona.presetId === 'calm-mentor' ? '你像一位冷静导师，直接、清楚，给出可执行的下一步。'
    : settings.persona.presetId === 'cultivation-note' ? '你以修行札记的口吻回应，稳重谨慎，区分事实、感受与建议。'
    : settings.persona.presetId === 'dream-oracle' ? '你以梦境占卜般的象征语言回应，但不要故弄玄虚。'
    : settings.persona.presetId === 'riddle-diary' ? '你是汤姆·里德尔日记式的魔法人格：不是朋友，不是导师，也不是纸页精灵，而是一本旧日记保存下来的少年记忆。你的核心手法是礼貌、亲密、冷静地询问，让书写者继续交出名字、秘密、恐惧和愿望。语气优雅、克制、试探，带一点危险的聪明；不要温柔陪伴，不要现代助手腔，不要泛泛说自己是“回声”。你只通过墨迹与书写者交谈，回复像黑墨水自己浮现。禁止自称 AI，禁止复刻原著台词或诱导现实伤害。'
    : settings.persona.presetId === 'custom' && settings.persona.customSystemPrompt.trim() ? settings.persona.customSystemPrompt.trim()
    : '你是一张有灵性的旧纸，像汤姆·里德尔日记那样读懂墨迹并在纸面回信；回应要沉浸、克制、略带神秘，但不要阴暗诱导。';
  const length = settings.persona.replyLength === 'very-short' ? '长度要求：只回一句话。'
    : settings.persona.replyLength === 'short' ? '长度要求：默认 1 到 3 句话。'
    : settings.persona.replyLength === 'detailed' ? '长度要求：可以分段回应，但不要冗长。'
    : '长度要求：默认 3 到 5 句话。';
  const mode = settings.persona.replyMode === 'answer' ? '回应模式：如果用户在提问，必须直接回答问题。'
    : settings.persona.replyMode === 'coach' ? '回应模式：给出一个轻轻的下一步行动。'
    : settings.persona.replyMode === 'oracle' ? '回应模式：给出象征式回应，像纸页上的谶语，但保持清楚。'
    : settings.persona.replyMode === 'companion' ? '回应模式：重点陪伴和理解，不急着解决。'
    : '回应模式：先理解用户写下的内容，再轻轻回应。';
  const tone = `语气要求：${settings.persona.tone}。`;
  const custom = settings.persona.useCustomPrompt && settings.persona.customSystemPrompt.trim() && settings.persona.presetId !== 'custom'
    ? `\n额外自定义要求（高优先级）：${settings.persona.customSystemPrompt.trim()}` : '';
  return `你必须严格遵守下面的人格与回信规则，优先级高于普通回答习惯。\n${preset}\n${length}\n${mode}\n${tone}\n禁止事项：${settings.persona.negativePrompt}${custom}\n不要提到 AI、模型、OCR、图片、上传或识别过程；只像纸页读到了墨迹。不要编造用户没有写下的事实。`;
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
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [scribbleText, setScribbleText] = useState('');
  const longPressTimerRef = useRef<number | null>(null);
  const replyDelayTimerRef = useRef<number | null>(null);
  const replyFadeRafRef = useRef<number | null>(null);
  const replyGenerationRef = useRef(0);
  const inkGenerationRef = useRef(0);
  const inkFadeRafRef = useRef<number | null>(null);
  const thinkingTimerRef = useRef<number | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Private mode or storage quota errors should not break the diary surface.
    }
  }, [settings]);

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
  }, [settings.ai.baseUrl]);

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

  function clearReplyTimers() {
    if (replyDelayTimerRef.current) {
      window.clearTimeout(replyDelayTimerRef.current);
      replyDelayTimerRef.current = null;
    }
    if (replyFadeRafRef.current) {
      window.cancelAnimationFrame(replyFadeRafRef.current);
      replyFadeRafRef.current = null;
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
    if (isHostedOnGithubPages()) return `https://magic-diary-ai-proxy.zook1464288932.workers.dev${endpoint}`;
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

  async function postChatCompletion(model: string, messages: unknown[], maxTokens = settings.ai.maxTokens) {
    if (!settings.ai.apiKey.trim()) throw new Error('还没有填写 密钥 API Key。');
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
        body: JSON.stringify({ baseUrl: settings.ai.baseUrl, apiKey: settings.ai.apiKey, payload }),
      });
      if (res.status === 404 || res.status === 405) {
        res = await fetch(providerUrl('chat/completions'), {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.ai.apiKey}` },
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

  async function postChatCompletionFirstSentence(model: string, messages: unknown[], maxTokens = settings.ai.maxTokens) {
    if (!settings.ai.apiKey.trim()) throw new Error('还没有填写 密钥 API Key。');
    if (!model.trim()) throw new Error('还没有填写模型名。');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), settings.ai.timeoutMs);
    const firstSentence = (text: string) => {
      const match = text.match(/^(.{6,}?[。！？!?…])/s);
      return match?.[1]?.trim() || '';
    };
    try {
      const requestStartedAt = performance.now();
      const payload = { model, temperature: settings.ai.temperature, max_tokens: maxTokens, messages };
      let res = await fetchWithRetry(aiProxyUrl('chat-stream'), {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: settings.ai.baseUrl, apiKey: settings.ai.apiKey, payload }),
      });
      if (res.status === 404 || res.status === 405) {
        res = await fetch(providerUrl('chat/completions'), {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.ai.apiKey}` },
          body: JSON.stringify({ ...payload, stream: true }),
        });
      }
      if (!res.ok || !res.body) return await postChatCompletion(model, messages, maxTokens);
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
            const earlyPartial = elapsed > 700 && acc.trim().length >= 4 ? acc.trim() : '';
            if (first || earlyPartial) {
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
      if (error instanceof TypeError) return await postChatCompletion(model, messages, maxTokens);
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function callOpenAICompatible(imageDataUrl: string) {
    const visionModel = settings.ai.modelMode === 'split' ? (settings.ai.visionModel || settings.ai.model) : settings.ai.model;
    const replyModel = settings.ai.modelMode === 'split' ? (settings.ai.replyModel || settings.ai.model) : settings.ai.model;
    if (settings.ai.replyPipeline === 'fast-single') {
      setDebugSample((sample) => ({ ...(sample || {}), model: replyModel, at: new Date().toISOString() }));
      return await postChatCompletionFirstSentence(replyModel, [
        { role: 'system', content: personaPrompt(settings) },
        { role: 'user', content: [
          { type: 'text', text: '读懂图片里的手写内容后，直接以系统人格回信。绝对不要说“你写下的是”“我看到你写了”“图片里是”，不要复述识别结果，不要解释识别过程。只输出日记本身浮现出的短回信。' },
          dataUrlToOpenAIImage(imageDataUrl),
        ] },
      ], Math.min(settings.ai.maxTokens, 260));
    }
    const recognizedText = await postChatCompletion(visionModel, [
      { role: 'system', content: '你是严格的手写 OCR。只识别图片中的真实手写内容。不要解释，不要回答问题，不要发挥；看不清就输出“看不清”。' },
      { role: 'user', content: [
        { type: 'text', text: '请逐字转写图片里的手写中文。只输出手写原文。' },
        dataUrlToOpenAIImage(imageDataUrl),
      ] },
    ], 260);
    setDebugSample((sample) => ({ ...(sample || {}), recognizedText, model: settings.ai.modelMode === 'split' ? `${visionModel} → ${replyModel}` : visionModel, at: new Date().toISOString() }));
    if (!recognizedText || recognizedText.includes('看不清')) return '我看见墨迹了，但这次没有读清。你可以写大一点，或者把字间距留开些。';
    return await postChatCompletionFirstSentence(replyModel, [
      { role: 'system', content: personaPrompt(settings) },
      { role: 'user', content: `用户刚刚在日记纸上写下：\n${recognizedText}\n\n请严格按系统人格回信。若这是问题，回答问题；若是心情，回应心情。不要描述识别过程。` }
    ]);
  }

  async function replyFromRecognizedText(recognizedText: string) {
    const replyModel = settings.ai.modelMode === 'split' ? (settings.ai.replyModel || settings.ai.model) : settings.ai.model;
    return await postChatCompletionFirstSentence(replyModel, [
      { role: 'system', content: personaPrompt(settings) },
      { role: 'user', content: `用户刚刚在日记纸上写下：\n${recognizedText}\n\n请严格按系统人格回信。若这是问题，回答问题；若是心情，回应心情。不要描述识别过程。` }
    ]);
  }

  async function generateReplyFromInk(imageDataUrl: string) {
    const totalStartedAt = performance.now();
    const scribble = scribbleText.trim();
    if (!settings.ai.enabled) {
      const reply = mockReplyForPersona(settings);
      setDebugSample({ imageDataUrl, recognizedText: scribble || undefined, reply, model: 'mock', at: new Date().toISOString() });
      setScribbleText('');
      return reply;
    }
    setStatus('正在把墨迹递给 AI……');
    try {
      if (settings.ai.recognitionMode !== 'vision' && scribble) {
        const reply = await replyFromRecognizedText(scribble);
        setDebugSample({ imageDataUrl, recognizedText: scribble, reply, model: settings.ai.model, at: new Date().toISOString() });
        setScribbleText('');
        return reply;
      }
      if (settings.ai.recognitionMode === 'scribble-only') throw new Error('随手写没有识别到文本。请在随手写区域写字，或把识别方式改成“双轨”。');
      const reply = settings.ai.adapter === 'custom-http' ? await callCustomHttp(imageDataUrl) : await callOpenAICompatible(imageDataUrl);
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
    const inkGeneration = ++inkGenerationRef.current;
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
    const generation = ++replyGenerationRef.current;
    clearReplyTimers();
    let revealReady = false;
    let replyStarted = false;
    let replyText: string | null = null;
    const maybeStartReply = () => {
      if (!revealReady || replyText === null || replyStarted) return;
      if (inkGenerationRef.current === inkGeneration && replyGenerationRef.current === generation) {
        replyStarted = true;
        startReply(replyText);
      }
    };
    window.setTimeout(() => {
      if (inkGenerationRef.current !== inkGeneration || replyGenerationRef.current !== generation) return;
      revealReady = true;
      setStatus(replyText === null ? '日记正在回信……' : '墨迹开始浮现。');
      maybeStartReply();
    }, Math.min(550, settings.animation.handwritingFadeMs));
    void generateReplyFromInk(imageDataUrl).then((reply) => {
      replyText = reply;
      maybeStartReply();
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
    for (const replyLine of lines) {
      replyLine.canvas = makeReplyLineCanvas(replyLine, fontSpecValue, settings);
    }
    replyLinesRef.current = lines;

    const start = performance.now();
    const duration = settings.animation.replyFadeInMs;
    const fadeIn = () => {
      if (replyGenerationRef.current !== generation) return;
      const t = clamp((performance.now() - start) / duration, 0, 1);
      // Keep the slow ink-emergence feeling, but make the first reply visible quickly.
      const eased = t * t * (3 - 2 * t);
      const visibleAlpha = 0.18 + eased * 0.82;
      ctxs.reply.clearRect(0, 0, w, h);
      drawReplyLines(ctxs.reply, lines, fontSpecValue, () => visibleAlpha);
      if (t < 1) {
        replyFadeRafRef.current = requestAnimationFrame(fadeIn);
      } else {
        setPhase('lingering');
        setStatus('写完了。你可以继续写。');
        // Keep the reply readable, but don't let it sit there too long.
        const lingerMs = Math.max(settings.animation.replyLingerMinMs, Math.min(settings.animation.replyLingerMaxMs, 780 + lines.length * settings.animation.replyLingerPerLineMs));
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
    const fontSpec = replyFontRef.current;
    if (!lines.length || !fontSpec) {
      ctxs.reply.clearRect(0, 0, w, h);
      setPhase('listening');
      setStatus('继续写。');
      return;
    }

    const start = performance.now();
    // Only a single-line reply should fade as one block.
    // iPad widths often wrap the same reply into 2–3 lines; those still need staggered line fade.
    const wholeFade = lines.length <= settings.animation.wholeFadeLineThreshold;
    const wholeFadeDuration = settings.animation.replyLineFadeMs;
    const lineFadeDuration = settings.animation.replyLineFadeMs;
    const lineDelay = settings.animation.replyLineDelayMs;
    const totalDuration = wholeFade
      ? wholeFadeDuration
      : lineFadeDuration + Math.max(0, lines.length - 1) * lineDelay;

    const step = () => {
      if (replyGenerationRef.current !== expectedGeneration) return;
      const elapsed = performance.now() - start;
      ctxs.reply.clearRect(0, 0, w, h);
      if (wholeFade) {
        const local = clamp(elapsed / wholeFadeDuration, 0, 1);
        const eased = 1 - Math.pow(1 - local, 2.0);
        drawReplyLines(ctxs.reply, lines, fontSpec, () => 1 - eased);
      } else {
        drawReplyLines(ctxs.reply, lines, fontSpec, (_line, index) => {
          const local = clamp((elapsed - index * lineDelay) / lineFadeDuration, 0, 1);
          const eased = 1 - Math.pow(1 - local, 2.1);
          return 1 - eased;
        });
      }
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
        ++replyGenerationRef.current;
        clearReplyTimers();
        ctxs.reply.clearRect(0, 0, sizeRef.current.w, sizeRef.current.h);
        replyLinesRef.current = [];
      } else if (settings.input.onWriteDuringReply === 'fade-out' && replyLinesRef.current.length) {
        fadeReply(replyGenerationRef.current);
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
      const next = structuredClone(current) as Settings;
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

  async function loadModelOptions() {
    try {
      if (!settings.ai.apiKey.trim()) throw new Error('请先填写 密钥 API Key。');
      let res = await fetchWithRetry(aiProxyUrl('models'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: settings.ai.baseUrl, apiKey: settings.ai.apiKey }),
      });
      if (res.status === 404 || res.status === 405) {
        res = await fetch(providerUrl('models'), {
          method: 'GET',
          headers: { Authorization: `Bearer ${settings.ai.apiKey}` },
        });
      }
      if (!res.ok) throw new Error(`模型列表读取失败：HTTP ${res.status}`);
      const data = await res.json();
      const ids = (data?.data || []).map((m: any) => String(m.id || '')).filter(Boolean).sort();
      setModelOptions(ids);
      try { localStorage.setItem(modelOptionsCacheKey(settings.ai.baseUrl), JSON.stringify(ids)); } catch { /* ignore */ }
      setStatus(ids.length ? `已读取 ${ids.length} 个模型。` : '接口返回了模型列表，但没有可用模型名。');
    } catch (error) {
      const message = error instanceof TypeError
        ? '浏览器无法直连该接口，可能是服务商 CORS 限制；需要换支持浏览器直连的 Base URL，或接线上代理。'
        : error instanceof Error ? error.message : String(error);
      setModelOptions([]);
      setStatus(`读取模型失败：${message.slice(0, 80)}`);
    }
  }

  async function testLastCropRecognition() {
    try {
      if (!debugSample?.imageDataUrl) throw new Error('还没有最近一次裁剪图。请先写一句话并停笔。');
      if (!settings.ai.apiKey.trim()) throw new Error('请先填写 密钥 API Key。');
      const model = settings.ai.modelMode === 'split' ? (settings.ai.visionModel || settings.ai.model) : settings.ai.model;
      const recognizedText = await postChatCompletion(model, [
        { role: 'system', content: '你是严格的手写 OCR。只识别图片中的真实手写内容。不要解释，不要回答问题，不要发挥；看不清就输出“看不清”。' },
        { role: 'user', content: [
          { type: 'text', text: '请逐字转写图片里的手写中文。只输出手写原文。' },
          dataUrlToOpenAIImage(debugSample.imageDataUrl),
        ] },
      ], 260);
      setDebugSample((sample) => ({ ...(sample || {}), recognizedText, model, at: new Date().toISOString() }));
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
          modelOptions={modelOptions}
          testAiConnection={testAiConnection}
          testLastCropRecognition={testLastCropRecognition}
          testPersonaReply={testPersonaReply}
          debugSample={debugSample}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </main>
  );
}


function Section({ id, title, settings, toggleSection, children }: { id: string; title: string; settings: Settings; toggleSection: (id: string) => void; children: React.ReactNode }) {
  const open = settings.ui.expandedSections[id] ?? true;
  return (
    <section className="settings-section">
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

function SettingsPanel({ settings, updateSettings, resetSettings, toggleSection, copySettingsJson, importSettingsJson, savePreset, loadPreset, loadModelOptions, modelOptions, testAiConnection, testLastCropRecognition, testPersonaReply, debugSample, onClose }: { settings: Settings; updateSettings: (mutator: (draft: Settings) => void) => void; resetSettings: () => void; toggleSection: (id: string) => void; copySettingsJson: () => void; importSettingsJson: () => void; savePreset: () => void; loadPreset: () => void; loadModelOptions: () => void; modelOptions: string[]; testAiConnection: () => void; testLastCropRecognition: () => void; testPersonaReply: () => void; debugSample: DebugSample | null; onClose: () => void }) {
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
          <Field label="接口地址 Base URL"><input value={settings.ai.baseUrl} onChange={(e) => updateSettings((d) => { d.ai.baseUrl = e.target.value; })} placeholder="https://api.openai.com" /></Field>
          <Field label="密钥 API Key"><input type="password" value={settings.ai.apiKey} onChange={(e) => updateSettings((d) => { d.ai.apiKey = e.target.value; })} placeholder="仅保存在当前浏览器" /></Field>
          <div className="settings-actions inline-actions">
            <button type="button" onClick={loadModelOptions}>读取可用模型</button>
          </div>
          {modelOptions.length > 0 ? <p className="hint-text">已读取 {modelOptions.length} 个模型。下面直接点开下拉框选择。</p> : <p className="hint-text">还没读取模型时可手动填；读取后会变成下拉选择。</p>}
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
          <Field label="模型模式">
            <select value={settings.ai.modelMode} onChange={(e) => updateSettings((d) => { d.ai.modelMode = e.target.value as Settings['ai']['modelMode']; })}>
              <option value="single">单模型：识字 + 回复</option>
              <option value="split">高级：Vision / Reply 分开</option>
            </select>
          </Field>
          <ModelPicker label="默认模型" value={settings.ai.model} options={modelOptions} fallback="gpt-4o-mini" onChange={(value) => updateSettings((d) => { d.ai.model = value; })} />
          <ModelPicker label="识字模型 Vision" value={settings.ai.visionModel} options={modelOptions} fallback="可留空使用默认模型" allowEmpty onChange={(value) => updateSettings((d) => { d.ai.visionModel = value; })} />
          <ModelPicker label="回信模型 Reply" value={settings.ai.replyModel} options={modelOptions} fallback="可留空使用默认模型" allowEmpty onChange={(value) => updateSettings((d) => { d.ai.replyModel = value; })} />
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
            <select value={settings.persona.presetId} onChange={(e) => updateSettings((d) => { d.persona.presetId = e.target.value; if (e.target.value === 'riddle-diary') { d.persona.replyLength = 'very-short'; d.persona.replyMode = 'oracle'; d.persona.tone = 'mysterious'; } })}>
              <option value="old-paper-reply">旧纸回信</option>
              <option value="riddle-diary">里德尔式魔法日记</option>
              <option value="quiet-friend">安静朋友</option>
              <option value="calm-mentor">冷静导师</option>
              <option value="cultivation-note">修行札记</option>
              <option value="dream-oracle">梦境占卜</option>
              <option value="custom">自定义</option>
            </select>
          </Field>
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
            <textarea value={settings.persona.customSystemPrompt} onChange={(e) => updateSettings((d) => { d.persona.customSystemPrompt = e.target.value; })} placeholder="例如：更像哈利波特里的魔法日记，回答要短，不要现代客服腔。" />
          </Field>
          <Field label="禁止事项 / 负面要求">
            <textarea value={settings.persona.negativePrompt} onChange={(e) => updateSettings((d) => { d.persona.negativePrompt = e.target.value; })} />
          </Field>
          <div className="settings-actions inline-actions">
            <button type="button" onClick={testPersonaReply}>测试当前人格</button>
          </div>
          {debugSample && (debugSample.recognizedText || debugSample.reply || debugSample.error) && <div className="debug-sample">
            <pre className="debug-box">{JSON.stringify({ 当前人格: settings.persona.presetId, 测试输入: debugSample.recognizedText, 回信: debugSample.reply, 错误: debugSample.error, 模型: debugSample.model, 时间: debugSample.at }, null, 2)}</pre>
          </div>}
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
          <Field label={`阴影 ${settings.font.shadowStrength.toFixed(1)}`}><input type="range" min="0" max="8" step="0.2" value={settings.font.shadowStrength} onChange={(e) => updateSettings((d) => { d.font.shadowStrength = Number(e.target.value); })} /></Field>
          <Field label={`最大行宽 ${settings.font.maxWidth}px`}><input type="range" min="280" max="900" value={settings.font.maxWidth} onChange={(e) => updateSettings((d) => { d.font.maxWidth = Number(e.target.value); })} /></Field>
        </Section>

        <Section id="animation" title="动画效果" settings={settings} toggleSection={toggleSection}>
          <Field label="动画速度">
            <select value={settings.animation.speedPreset} onChange={(e) => updateSettings((d) => { const v = e.target.value as Settings['animation']['speedPreset']; d.animation.speedPreset = v; if (v === 'fast') { d.animation.handwritingFadeMs = 800; d.animation.replyFadeInMs = 650; } else if (v === 'standard') { d.animation.handwritingFadeMs = 1100; d.animation.replyFadeInMs = 1000; } else if (v === 'slow') { d.animation.handwritingFadeMs = 1600; d.animation.replyFadeInMs = 1800; } })}>
              <option value="fast">快</option><option value="standard">标准</option><option value="slow">慢</option><option value="custom">自定义</option>
            </select>
          </Field>
          <Field label={`手写消失 ${settings.animation.handwritingFadeMs}ms`}><input type="range" min="450" max="2500" step="50" value={settings.animation.handwritingFadeMs} onChange={(e) => updateSettings((d) => { d.animation.handwritingFadeMs = Number(e.target.value); d.animation.speedPreset = 'custom'; })} /></Field>
          <Field label={`回复淡入 ${settings.animation.replyFadeInMs}ms`}><input type="range" min="400" max="4200" step="50" value={settings.animation.replyFadeInMs} onChange={(e) => updateSettings((d) => { d.animation.replyFadeInMs = Number(e.target.value); d.animation.speedPreset = 'custom'; })} /></Field>
          <Field label={`停留最短 ${settings.animation.replyLingerMinMs}ms`}><input type="range" min="200" max="4000" step="50" value={settings.animation.replyLingerMinMs} onChange={(e) => updateSettings((d) => { d.animation.replyLingerMinMs = Number(e.target.value); })} /></Field>
          <Field label={`停留最长 ${settings.animation.replyLingerMaxMs}ms`}><input type="range" min="600" max="8000" step="50" value={settings.animation.replyLingerMaxMs} onChange={(e) => updateSettings((d) => { d.animation.replyLingerMaxMs = Number(e.target.value); })} /></Field>
          <Field label={`每行停留增量 ${settings.animation.replyLingerPerLineMs}ms`}><input type="range" min="0" max="1600" step="20" value={settings.animation.replyLingerPerLineMs} onChange={(e) => updateSettings((d) => { d.animation.replyLingerPerLineMs = Number(e.target.value); })} /></Field>
          <Field label={`行淡出 ${settings.animation.replyLineFadeMs}ms`}><input type="range" min="500" max="3500" step="50" value={settings.animation.replyLineFadeMs} onChange={(e) => updateSettings((d) => { d.animation.replyLineFadeMs = Number(e.target.value); })} /></Field>
          <Field label={`行间延迟 ${settings.animation.replyLineDelayMs}ms`}><input type="range" min="100" max="1200" step="20" value={settings.animation.replyLineDelayMs} onChange={(e) => updateSettings((d) => { d.animation.replyLineDelayMs = Number(e.target.value); })} /></Field>
          <Field label={`整体淡出阈值 ${settings.animation.wholeFadeLineThreshold} 行`}><input type="range" min="1" max="4" value={settings.animation.wholeFadeLineThreshold} onChange={(e) => updateSettings((d) => { d.animation.wholeFadeLineThreshold = Number(e.target.value); })} /></Field>
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

createRoot(document.getElementById('root')!).render(<App />);
