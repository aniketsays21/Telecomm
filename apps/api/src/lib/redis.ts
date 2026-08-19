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

export function redisConnection(): RedisOptions | { url: string } & RedisOptions {
  const url = process.env.REDIS_URL?.trim();
  if (url) {
    return {
      // ioredis / BullMQ accept a URL passed via the shared options bag when
      // you type-assert it; simpler is to parse it ourselves so both host/port
      // AND auth make it into the client without depending on undocumented
      // pass-through behavior.
      ...parseRedisUrl(url),
      maxRetriesPerRequest: null,
    };
  }
  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    username: process.env.REDIS_USERNAME || undefined,
    maxRetriesPerRequest: null,
  };
}

function parseRedisUrl(raw: string): Pick<RedisOptions, 'host' | 'port' | 'username' | 'password' | 'tls'> {
  const url = new URL(raw);
  const opts: ReturnType<typeof parseRedisUrl> = {
    host: url.hostname,
    port: Number(url.port || 6379),
  };
  if (url.username) opts.username = decodeURIComponent(url.username);
  if (url.password) opts.password = decodeURIComponent(url.password);
  if (url.protocol === 'rediss:') opts.tls = {};
  return opts;
}
