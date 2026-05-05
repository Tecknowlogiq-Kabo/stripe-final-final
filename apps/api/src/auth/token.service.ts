import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { RedisService } from '../redis/redis.service';

const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

interface TokenPayload {
  id: string;
  email: string;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly redis: RedisService,
  ) {}

  async issueTokenPair(user: TokenPayload): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = this.jwtService.sign({ sub: user.id, email: user.email });
    const refreshToken = randomUUID();
    await this.redis.set(`refresh:${refreshToken}`, { id: user.id, email: user.email }, REFRESH_TTL_SECONDS);
    return { accessToken, refreshToken };
  }

  async validateRefreshToken(refreshToken: string): Promise<TokenPayload | null> {
    return this.redis.get<TokenPayload>(`refresh:${refreshToken}`);
  }

  async revokeRefreshToken(refreshToken: string): Promise<void> {
    await this.redis.del(`refresh:${refreshToken}`);
  }
}
