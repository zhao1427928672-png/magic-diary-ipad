export type InkMask = { width: number; height: number; pixels: boolean[] };
export type InkPoint = { x: number; y: number };
export type InkStroke = InkPoint[];

function cloneMask(mask: InkMask): InkMask {
  return { width: mask.width, height: mask.height, pixels: [...mask.pixels] };
}

function idx(mask: InkMask, x: number, y: number) {
  return y * mask.width + x;
}

function at(mask: InkMask, x: number, y: number) {
  return x >= 0 && y >= 0 && x < mask.width && y < mask.height && mask.pixels[idx(mask, x, y)];
}

export function thinMask(input: InkMask): InkMask {
  const mask = cloneMask(input);
  const { width: w, height: h } = mask;
  if (w < 3 || h < 3) return mask;

  while (true) {
    let changed = false;
    for (let phase = 0; phase < 2; phase += 1) {
      const toClear: number[] = [];
      for (let y = 1; y < h - 1; y += 1) {
        for (let x = 1; x < w - 1; x += 1) {
          if (!at(mask, x, y)) continue;
          const p = [
            at(mask, x, y - 1),
            at(mask, x + 1, y - 1),
            at(mask, x + 1, y),
            at(mask, x + 1, y + 1),
            at(mask, x, y + 1),
            at(mask, x - 1, y + 1),
            at(mask, x - 1, y),
            at(mask, x - 1, y - 1),
          ];
          const b = p.filter(Boolean).length;
          if (b < 2 || b > 6) continue;
          let a = 0;
          for (let i = 0; i < 8; i += 1) if (!p[i] && p[(i + 1) % 8]) a += 1;
          if (a !== 1) continue;
          const c1 = phase === 0 ? !(p[0] && p[2] && p[4]) : !(p[0] && p[2] && p[6]);
          const c2 = phase === 0 ? !(p[2] && p[4] && p[6]) : !(p[0] && p[4] && p[6]);
          if (c1 && c2) toClear.push(idx(mask, x, y));
        }
      }
      if (toClear.length) {
        changed = true;
        for (const i of toClear) mask.pixels[i] = false;
      }
    }
    if (!changed) break;
  }
  return mask;
}

function neighbors(mask: InkMask, x: number, y: number) {
  const out: Array<[number, number]> = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if ((dx || dy) && at(mask, x + dx, y + dy)) out.push([x + dx, y + dy]);
    }
  }
  return out;
}

export function rasterizeText(text: string, fontSpec: string): InkMask {
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = fontSpec;
  const metrics = measure.measureText(text || ' ');
  const fontSize = Number(fontSpec.match(/^(\d+(?:\.\d+)?)px/)?.[1] ?? 48);
  const width = Math.max(1, Math.ceil(metrics.width + fontSize * 0.5));
  const height = Math.max(1, Math.ceil(fontSize * 2.1));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, width, height);
  ctx.font = fontSpec;
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'white';
  ctx.fillText(text, fontSize * 0.18, fontSize * 0.18);
  const image = ctx.getImageData(0, 0, width, height);
  const pixels: boolean[] = [];
  for (let i = 0; i < image.data.length; i += 4) pixels.push(image.data[i] > 127);
  return { width, height, pixels };
}

export function strokesForText(text: string, fontSpec: string): InkStroke[] {
  return traceMask(thinMask(rasterizeText(text, fontSpec)));
}

export function traceMask(mask: InkMask): InkStroke[] {
  const visited = new Array(mask.width * mask.height).fill(false);
  const starts: Array<[number, number]> = [];
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      if (at(mask, x, y) && neighbors(mask, x, y).length === 1) starts.push([x, y]);
    }
  }
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) if (at(mask, x, y)) starts.push([x, y]);
  }

  const strokes: InkStroke[] = [];
  for (const [sx, sy] of starts) {
    if (visited[idx(mask, sx, sy)]) continue;
    const path: InkStroke = [{ x: sx, y: sy }];
    visited[idx(mask, sx, sy)] = true;
    let cx = sx;
    let cy = sy;
    while (true) {
      const next = neighbors(mask, cx, cy).find(([nx, ny]) => !visited[idx(mask, nx, ny)]);
      if (!next) break;
      const [nx, ny] = next;
      visited[idx(mask, nx, ny)] = true;
      path.push({ x: nx, y: ny });
      cx = nx;
      cy = ny;
    }
    if (path.length >= 2) strokes.push(path);
  }
  strokes.sort((a, b) => Math.min(...a.map((p) => p.x)) - Math.min(...b.map((p) => p.x)));
  return strokes;
}
