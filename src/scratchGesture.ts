export type GesturePoint = { x: number; y: number; t: number };
export type GestureStroke = { points: GesturePoint[] };
export type GestureBox = { x: number; y: number; w: number; h: number };

export type ReplyHitMask = {
  scale: number;
  width: number;
  height: number;
  alpha: Uint8Array;
};

export type ScratchMetrics = {
  recognized: boolean;
  score: number;
  hitCount: number;
  targetRatio: number;
  horizontalCoverage: number;
  directionReversals: number;
  pathLength: number;
  durationMs: number;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function unionBoxes(boxes: GestureBox[]): GestureBox | null {
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.w));
  const bottom = Math.max(...boxes.map((box) => box.y + box.h));
  return { x, y, w: right - x, h: bottom - y };
}

export function pointHitsReplyMask(mask: ReplyHitMask | null, point: GesturePoint) {
  if (!mask) return false;
  const cx = Math.round(point.x * mask.scale);
  const cy = Math.round(point.y * mask.scale);
  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      const x = cx + ox;
      const y = cy + oy;
      if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) continue;
      if (mask.alpha[y * mask.width + x] > 24) return true;
    }
  }
  return false;
}

export function scoreScratchGesture(strokes: GestureStroke[], target: GestureBox, mask: ReplyHitMask | null): ScratchMetrics {
  const points = strokes.flatMap((stroke) => stroke.points);
  if (points.length < 4) {
    return { recognized: false, score: 0, hitCount: 0, targetRatio: 0, horizontalCoverage: 0, directionReversals: 0, pathLength: 0, durationMs: 0 };
  }

  let pathLength = 0;
  let directionReversals = 0;
  let previousDirection = 0;
  let insideTarget = 0;
  let hitCount = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  const expanded = { x: target.x - 14, y: target.y - 14, w: target.w + 28, h: target.h + 28 };

  for (const stroke of strokes) {
    for (let index = 0; index < stroke.points.length; index += 1) {
      const point = stroke.points[index];
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      if (point.x >= expanded.x && point.x <= expanded.x + expanded.w && point.y >= expanded.y && point.y <= expanded.y + expanded.h) insideTarget += 1;
      if (pointHitsReplyMask(mask, point)) hitCount += 1;
      if (index === 0) continue;
      const previous = stroke.points[index - 1];
      const dx = point.x - previous.x;
      const dy = point.y - previous.y;
      pathLength += Math.hypot(dx, dy);
      const direction = Math.abs(dx) >= 2 ? Math.sign(dx) : 0;
      if (direction && previousDirection && direction !== previousDirection) directionReversals += 1;
      if (direction) previousDirection = direction;
    }
  }

  const startedAt = Math.min(...points.map((point) => point.t));
  const endedAt = Math.max(...points.map((point) => point.t));
  const durationMs = Math.max(1, endedAt - startedAt);
  const targetRatio = insideTarget / points.length;
  const horizontalCoverage = clamp((maxX - minX) / Math.max(1, target.w), 0, 2);
  const speed = pathLength / durationMs * 1000;
  const destructiveIntent = directionReversals > 0 || strokes.length >= 2;

  let score = 0;
  if (targetRatio >= 0.55) score += 2;
  if (horizontalCoverage >= 0.35) score += 2;
  if (pathLength >= Math.max(90, target.w * 0.65)) score += 2;
  if (destructiveIntent) score += 2;
  if (hitCount >= 3) score += 2;
  if (speed >= 120) score += 1;

  return {
    recognized: score >= 8 && hitCount >= 3,
    score,
    hitCount,
    targetRatio,
    horizontalCoverage,
    directionReversals,
    pathLength,
    durationMs,
  };
}
