/**
 * Input sanitization utilities for webhook/hook payloads.
 * Defense-in-depth: validate and truncate untrusted input before processing.
 */

/** Return a trimmed string truncated to maxLen, or null if not a valid string. */
export function safeString(value: unknown, maxLen = 256): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, maxLen);
}

/** Validate that a URL uses http or https protocol only. Returns null for invalid/dangerous URLs. */
export function safeUrl(value: unknown, maxLen = 2048): string | null {
  const s = safeString(value, maxLen);
  if (!s) return null;
  try {
    const url = new URL(s);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return s;
    }
    return null;
  } catch {
    return null;
  }
}

/** Validate that a value belongs to an allowed set. Returns null if not in set. */
export function safeEnum<T extends string>(value: unknown, allowed: Set<T>): T | null {
  if (typeof value !== 'string') return null;
  return allowed.has(value as T) ? (value as T) : null;
}
