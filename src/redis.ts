import { Redis } from 'ioredis';

const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

export function createRedisClient(): Redis {
  return new Redis(REDIS_URL);
}
