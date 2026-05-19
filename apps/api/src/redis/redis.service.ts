import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const CacheKeys = {
  customer: (id: string) => `customer:${id}`,
  customerByStripe: (stripeId: string) => `customer:stripe:${stripeId}`,
  customerByUserId: (userId: string) => `customer:user:${userId}`,
  plans: (activeOnly: boolean) => `plans:${activeOnly ? 'active' : 'all'}`,
};

export const CacheTtl = {
  CUSTOMER: 300,   // 5 minutes
  PLANS: 3600,     // 1 hour
};

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.client = new Redis(this.config.get<string>('redis.url')!);
    this.client.on('connect', () => this.logger.log('Redis connected'));
    this.client.on('error', (err: Error) => this.logger.error({ message: 'Redis error', err }));
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const val = await this.client.get(key);
      return val ? (JSON.parse(val) as T) : null;
    } catch (err) {
      this.logger.error({ message: 'Redis get failed, cache miss', key, err });
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      if (ttlSeconds) {
        await this.client.setex(key, ttlSeconds, serialized);
      } else {
        await this.client.set(key, serialized);
      }
    } catch (err) {
      this.logger.warn({ message: 'Redis set failed, skipping cache write', key, err });
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (!keys.length) return;
    try {
      await this.client.del(...keys);
    } catch (err) {
      this.logger.warn({ message: 'Redis del failed', keys, err });
    }
  }

  /**
   * Atomic increment; returns the new value. Used by throttler.
   * Fail-open: returns 0 on Redis failure so throttler allows requests through.
   */
  async incr(key: string): Promise<number> {
    try {
      return await this.client.incr(key);
    } catch (err) {
      this.logger.error({ message: 'Redis incr failed, failing open (returning 0)', key, err });
      return 0;
    }
  }

  /**
   * Returns TTL in seconds; -1 if no expiry, -2 if key missing.
   * Fail-open: returns -2 (key missing) on Redis failure so throttler treats as no existing hits.
   */
  async ttl(key: string): Promise<number> {
    try {
      return await this.client.ttl(key);
    } catch (err) {
      this.logger.error({ message: 'Redis ttl failed, failing open (returning -2)', key, err });
      return -2;
    }
  }

  /**
   * Set expiry on an existing key (seconds).
   * Fail-open: silently skips on Redis failure — throttler will retry on next request.
   */
  async expire(key: string, seconds: number): Promise<void> {
    try {
      await this.client.expire(key, seconds);
    } catch (err) {
      this.logger.error({ message: 'Redis expire failed, skipping', key, seconds, err });
    }
  }

  /**
   * SETEX — set value with TTL in one atomic call.
   * Fail-open: silently skips on Redis failure — throttler will retry on next request.
   */
  async setWithExpiry(key: string, value: string, ttlSeconds: number): Promise<void> {
    try {
      await this.client.setex(key, ttlSeconds, value);
    } catch (err) {
      this.logger.error({ message: 'Redis setex failed, skipping', key, ttlSeconds, err });
    }
  }

  async ping(): Promise<string> {
    return this.client.ping();
  }
}
