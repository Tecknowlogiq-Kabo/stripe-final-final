import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { RedisService } from '../redis/redis.service';
import { UserRole } from '../entities/user.entity';

const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

interface TokenPayload {
  id: string;
  email: string;
  role: UserRole;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly redis: RedisService,
  ) {}

  async issueTokenPair(user: TokenPayload): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = this.jwtService.sign({ sub: user.id, email: user.email, role: user.role });
    const refreshToken = randomUUID();
    // Redis.set() silently skips on failure (fail-open for cache paths).
    // But refresh tokens MUST be persisted — a silent skip means the JWT expires
    // after 15 min with no recovery path. Verify Redis is available first.
    try {
      await this.redis.ping();
      await this.redis.set(`refresh:${refreshToken}`, { id: user.id, email: user.email, role: user.role }, REFRESH_TTL_SECONDS);
    } catch {
      throw new InternalServerErrorException('Unable to create session. Please try again.');
    }
    return { accessToken, refreshToken };
  }

  async validateRefreshToken(refreshToken: string): Promise<TokenPayload | null> {
    return this.redis.get<TokenPayload>(`refresh:${refreshToken}`);
  }

  async revokeRefreshToken(refreshToken: string): Promise<void> {
    await this.redis.del(`refresh:${refreshToken}`);
  }
}
