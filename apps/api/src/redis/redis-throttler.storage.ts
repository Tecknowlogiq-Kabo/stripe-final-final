import { Injectable } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { RedisService } from './redis.service';

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    _throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const hitKey = `throttle:hit:${key}`;
    const blockKey = `throttle:block:${key}`;

    // If currently blocked, short-circuit
    const blockTtl = await this.redis.ttl(blockKey);
    if (blockTtl > 0) {
      return {
        totalHits: limit + 1,
        timeToExpire: 0,
        isBlocked: true,
        timeToBlockExpire: blockTtl,
      };
    }

    // Atomic increment
    const totalHits = await this.redis.incr(hitKey);

    // Set expiry on first hit
    if (totalHits === 1) {
      await this.redis.expire(hitKey, Math.ceil(ttl / 1000));
    }

    const timeToExpire = Math.max(0, await this.redis.ttl(hitKey));

    if (totalHits > limit) {
      const blockSeconds = Math.ceil(blockDuration / 1000) || Math.ceil(ttl / 1000);
      await this.redis.expire(blockKey, blockSeconds);
      await this.redis.setWithExpiry(blockKey, '1', blockSeconds);
      return {
        totalHits,
        timeToExpire,
        isBlocked: true,
        timeToBlockExpire: blockSeconds,
      };
    }

    return { totalHits, timeToExpire, isBlocked: false, timeToBlockExpire: 0 };
  }
}
