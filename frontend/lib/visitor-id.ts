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

  try {
    const existing = localStorage.getItem(VISITOR_ID_KEY);
    if (existing) return existing;
  } catch {
    // Some browsers/privacy modes can block storage access.
  }

  const next = `v-${Date.now().toString(36)}-${randomPart()}`;

  try {
    localStorage.setItem(VISITOR_ID_KEY, next);
  } catch {
    // Fallback to sessionStorage when localStorage is unavailable.
    try {
      sessionStorage.setItem(VISITOR_ID_KEY, next);
      const sessionValue = sessionStorage.getItem(VISITOR_ID_KEY);
      if (sessionValue) return sessionValue;
    } catch {
      // Ignore and continue with in-memory value.
    }
  }

  return next;
}
