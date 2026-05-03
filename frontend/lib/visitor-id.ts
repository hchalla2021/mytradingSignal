const VISITOR_ID_KEY = 'mdts_visitor_id';

function randomPart(): string {
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    const bytes = new Uint8Array(8);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return Math.random().toString(16).slice(2, 14);
}

export function getOrCreateVisitorId(): string {
  if (typeof window === 'undefined') return 'server';

  const existing = localStorage.getItem(VISITOR_ID_KEY);
  if (existing) return existing;

  const next = `v-${Date.now().toString(36)}-${randomPart()}`;
  localStorage.setItem(VISITOR_ID_KEY, next);
  return next;
}
