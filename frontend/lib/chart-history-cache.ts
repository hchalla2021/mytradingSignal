export function createHistoryPageCache<T>(limit = 12, ttl = 20_000) {
  const pages = new Map<string, { value: T; fetched: number }>();
  const pending = new Map<string, Promise<T>>();
  const write = (key: string, value: T) => {
    pages.delete(key);
    pages.set(key, { value, fetched: Date.now() });
    while (pages.size > limit) pages.delete(pages.keys().next().value!);
  };
  return {
    write,
    read(key: string) {
      const page = pages.get(key);
      if (!page) return undefined;
      pages.delete(key);
      pages.set(key, page);
      return { value: page.value, fresh: Date.now() - page.fetched < ttl };
    },
    load(key: string, fetchPage: () => Promise<T>): Promise<T> {
      const existing = pending.get(key);
      if (existing) return existing;
      const request = fetchPage().then(value => {
        write(key, value);
        return value;
      }).finally(() => { pending.delete(key); });
      pending.set(key, request);
      return request;
    },
  };
}
