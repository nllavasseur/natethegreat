type CacheEntry<T> = { value: T; updatedAt: number };

let quotesDrafts: CacheEntry<any[]> | null = null;
let calendarDrafts: CacheEntry<any[]> | null = null;

export function getQuotesDraftsSession<T = any[]>(): T | null {
  return (quotesDrafts?.value as any) ?? null;
}

export function setQuotesDraftsSession<T = any[]>(value: T) {
  quotesDrafts = { value: (value as any) ?? [], updatedAt: Date.now() };
}

export function getCalendarDraftsSession<T = any[]>(): T | null {
  return (calendarDrafts?.value as any) ?? null;
}

export function setCalendarDraftsSession<T = any[]>(value: T) {
  calendarDrafts = { value: (value as any) ?? [], updatedAt: Date.now() };
}

export function clearDraftsSessionCache() {
  quotesDrafts = null;
  calendarDrafts = null;
}
