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

/** A cross-platform display basename, with no control characters or path prefix. */
export function safeBasename(value: unknown): string | null {
  const text = safeString(value, 4096);
  if (!text) return null;
  const part = text.replace(/\\/g, '/').split('/').filter(Boolean).pop();
  if (!part || part === '.' || part === '..') return null;
  return part.replace(/\p{Cc}/gu, '').slice(0, 128) || null;
}

/** Identifiers are metadata, never freeform descriptions or model output. */
export function safeIdentifier(value: unknown, maxLen = 128): string | null {
  const text = typeof value === 'string' && value.length <= maxLen ? value.trim() : null;
  return text && /^[\w.:-]+$/.test(text) ? text : null;
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
