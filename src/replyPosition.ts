export type ReplyPositionMode = 'auto' | 'fixed-center' | 'follow-writing';

export type Box = { x: number; y: number; w: number; h: number };

export type ReplyPositionInput = {
  mode: ReplyPositionMode;
  canvasW: number;
  canvasH: number;
  replyW: number;
  replyH: number;
  inputBox?: Box | null;
  safeTop?: number;
  safeBottom?: number;
  margin?: number;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function centeredX(input: ReplyPositionInput) {
  if (input.inputBox && input.mode !== 'fixed-center') {
    return clamp(input.inputBox.x + input.inputBox.w / 2 - input.replyW / 2, input.margin ?? 36, input.canvasW - input.replyW - (input.margin ?? 36));
  }
  return clamp((input.canvasW - input.replyW) / 2, input.margin ?? 36, input.canvasW - input.replyW - (input.margin ?? 36));
}

function safeCenterY(input: ReplyPositionInput) {
  const safeTop = input.safeTop ?? 56;
  const safeBottom = input.safeBottom ?? 92;
  return Math.round(safeTop + (input.canvasH - safeTop - safeBottom - input.replyH) / 2);
}

export function computeReplyPosition(input: ReplyPositionInput) {
  const margin = input.margin ?? 36;
  const safeTop = input.safeTop ?? 56;
  const safeBottom = input.safeBottom ?? 92;
  const minY = safeTop;
  const maxY = input.canvasH - safeBottom - input.replyH;
  const x = Math.round(centeredX(input));

  if (input.mode === 'fixed-center' || !input.inputBox) {
    return { x, y: clamp(safeCenterY(input), minY, maxY) };
  }

  const followGap = input.mode === 'follow-writing' ? 8 : 24;
  const belowY = input.inputBox.y + input.inputBox.h + followGap;
  const aboveY = input.inputBox.y - input.replyH - followGap;
  const belowFits = belowY <= maxY;
  const aboveFits = aboveY >= minY;

  if (input.mode === 'follow-writing') {
    if (belowFits) return { x, y: Math.round(belowY) };
    if (aboveFits) return { x, y: Math.round(aboveY) };
    return { x, y: clamp(safeCenterY(input), minY, maxY) };
  }

  if (belowFits) return { x, y: Math.round(belowY) };
  if (aboveFits) return { x, y: Math.round(aboveY) };
  return { x, y: clamp(safeCenterY(input), minY, maxY) };
}
