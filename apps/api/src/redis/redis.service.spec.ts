import { RedisService } from './redis.service';
import { ConfigService } from '@nestjs/config';

describe('Fix 1: Redis throttler methods fail-open on error', () => {
  let redis: RedisService;
  let mockClient: { incr: jest.Mock; ttl: jest.Mock; expire: jest.Mock; setex: jest.Mock };

  beforeEach(() => {
    mockClient = {
      incr: jest.fn(),
      ttl: jest.fn(),
      expire: jest.fn(),
      setex: jest.fn(),
    };

    const mockConfig = { get: jest.fn().mockReturnValue('redis://localhost:6379') };

    redis = new RedisService(mockConfig as any);
    // Inject the mock client
    (redis as any).client = mockClient;
  });

  describe('incr()', () => {
    it('returns the incremented value when Redis is healthy', async () => {
      mockClient.incr.mockResolvedValue(5);
      const result = await redis.incr('throttle:hit:127.0.0.1');
      expect(result).toBe(5);
    });

    it('returns 0 (fail-open) when Redis throws', async () => {
      mockClient.incr.mockRejectedValue(new Error('Connection refused'));
      const result = await redis.incr('throttle:hit:127.0.0.1');
      expect(result).toBe(0); // Fail-open: allows request through
    });
  });

  describe('ttl()', () => {
    it('returns TTL when Redis is healthy', async () => {
      mockClient.ttl.mockResolvedValue(30);
      const result = await redis.ttl('throttle:hit:127.0.0.1');
      expect(result).toBe(30);
    });

    it('returns -2 (key missing, fail-open) when Redis throws', async () => {
      mockClient.ttl.mockRejectedValue(new Error('Connection refused'));
      const result = await redis.ttl('throttle:hit:127.0.0.1');
      expect(result).toBe(-2); // Fail-open: treats as no existing hits
    });
  });

  describe('expire()', () => {
    it('sets expiry when Redis is healthy', async () => {
      mockClient.expire.mockResolvedValue(1);
      await expect(redis.expire('throttle:key', 60)).resolves.toBeUndefined();
    });

    it('silently skips when Redis throws (fail-open)', async () => {
      mockClient.expire.mockRejectedValue(new Error('Connection refused'));
      await expect(redis.expire('throttle:key', 60)).resolves.toBeUndefined();
      // Should not throw — fail-open
    });
  });

  describe('setWithExpiry()', () => {
    it('sets with TTL when Redis is healthy', async () => {
      mockClient.setex.mockResolvedValue('OK');
      await expect(redis.setWithExpiry('key', 'val', 60)).resolves.toBeUndefined();
    });

    it('silently skips when Redis throws (fail-open)', async () => {
      mockClient.setex.mockRejectedValue(new Error('Connection refused'));
      await expect(redis.setWithExpiry('key', 'val', 60)).resolves.toBeUndefined();
      // Should not throw — fail-open
    });
  });

  describe('get() and set() (cache operations, already had error handling)', () => {
    it('get() returns null on Redis error (existing behavior)', async () => {
      const mockGet = jest.fn().mockRejectedValue(new Error('OOM'));
      (redis as any).client.get = mockGet;
      const result = await redis.get('customer:123');
      expect(result).toBeNull();
    });

    it('set() silently skips on Redis error (existing behavior)', async () => {
      const mockSetex = jest.fn().mockRejectedValue(new Error('OOM'));
      (redis as any).client.setex = mockSetex;
      await expect(redis.set('customer:123', { name: 'test' }, 300)).resolves.toBeUndefined();
    });
  });
});
