/**
 * Single source of truth for the Redis connection options every BullMQ Queue
 * and Worker in this service uses.
 *
 * Railway's managed Redis requires AUTH — the plugin injects a full URL like
 * `redis://default:<password>@<host>:<port>` into `REDIS_URL`. The old code
 * only read `REDIS_HOST` + `REDIS_PORT` and never passed a password, so on
 * Railway every `queue.add()` and worker connection hung forever waiting on
 * an AUTH the driver never sent. Prefer `REDIS_URL` when present; fall back
 * to discrete host/port/password vars for local dev and other providers.
 *
 * `maxRetriesPerRequest: null` is required by BullMQ (documented in its docs);
 * with the default value BullMQ refuses to consume the connection.
 */
import type { RedisOptions } from 'ioredis';

export function redisConnection(): RedisOptions {
  const url = process.env.REDIS_URL?.trim();
  if (url) {
    const parsed = tryParseRedisUrl(url);
    if (parsed) {
      return { ...parsed, maxRetriesPerRequest: null };
    }
    // Malformed REDIS_URL (usually an unresolved Railway template like
    // `redis://:@:`). Fall through to discrete vars rather than crashing the
    // process at module load — the queue instantiations sit at file top
    // level, and a throw here would take the entire API down.
    console.warn(
      `[redis] REDIS_URL is set but not a valid URL (got: ${JSON.stringify(url)}). ` +
        `Falling back to REDIS_HOST/PORT/PASSWORD. Fix the Railway reference — usually ` +
        `\${{Redis.REDIS_PRIVATE_URL}} resolves cleanly where \${{Redis.REDIS_URL}} does not.`,
    );
  }
  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    username: process.env.REDIS_USERNAME || undefined,
    maxRetriesPerRequest: null,
  };
}

function tryParseRedisUrl(
  raw: string,
): Pick<RedisOptions, 'host' | 'port' | 'username' | 'password' | 'tls'> | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  // Guard against an unresolved template like `redis://:@:` that technically
  // parses in some Node versions but has no host to connect to.
  if (!url.hostname) return null;
  const opts: Pick<RedisOptions, 'host' | 'port' | 'username' | 'password' | 'tls'> = {
    host: url.hostname,
    port: Number(url.port || 6379),
  };
  if (url.username) opts.username = decodeURIComponent(url.username);
  if (url.password) opts.password = decodeURIComponent(url.password);
  if (url.protocol === 'rediss:') opts.tls = {};
  return opts;
}
