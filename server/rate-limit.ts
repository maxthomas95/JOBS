/**
 * Simple in-memory sliding-window rate limiter.
 * No external dependencies — just a Map of timestamps per IP.
 */
import type { Request, Response, NextFunction } from 'express';

interface RateLimiterOptions {
  windowMs?: number;
  maxRequests?: number;
  keyFn?: (req: Request) => string;
}

interface Bucket {
  timestamps: number[];
}

export function createRateLimiter(options: RateLimiterOptions = {}) {
  const windowMs = options.windowMs ?? 60_000;
  const maxRequests = options.maxRequests ?? 120;
  const keyFn = options.keyFn ?? ((req: Request) => req.ip ?? 'unknown');

  const buckets = new Map<string, Bucket>();

  // Clean up stale buckets every 60 seconds
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);
      if (bucket.timestamps.length === 0) {
        buckets.delete(key);
      }
    }
  }, 60_000);
  cleanupInterval.unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = keyFn(req);
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { timestamps: [] };
      buckets.set(key, bucket);
    }

    // Remove expired timestamps
    bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);

    if (bucket.timestamps.length >= maxRequests) {
      res.status(429).json({ ok: false, error: 'Too many requests' });
      return;
    }

    bucket.timestamps.push(now);
    next();
  };
}
