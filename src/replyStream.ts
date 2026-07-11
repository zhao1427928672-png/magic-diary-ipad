export function shouldFlushReplyUpdate(delivered: string, current: string) {
  if (!current || current === delivered) return false;
  const delta = current.startsWith(delivered) ? current.slice(delivered.length) : current;
  return Array.from(delta).length >= 8 || /[。！？!?…\n]/u.test(delta);
}
