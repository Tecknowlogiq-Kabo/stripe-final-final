import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { User } from '../entities/user.entity';
import { RedisService } from '../redis/redis.service';
import { RegisterDto, LoginDto } from './dto/auth.dto';

const SALT_ROUNDS = 12;

const USER_SELECT = `ID AS "id", EMAIL AS "email", PASSWORD_HASH AS "passwordHash", CREATED_AT AS "createdAt", UPDATED_AT AS "updatedAt"`;

const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string };
}

@Injectable()
export class AuthService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly jwtService: JwtService,
    private readonly redis: RedisService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const [existing] = await this.dataSource.query<User[]>(
      `SELECT ${USER_SELECT} FROM APP_USERS WHERE EMAIL = :1 AND ROWNUM = 1`,
      [dto.email],
    );
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const id = randomUUID();

    await this.dataSource.query(
      `INSERT INTO APP_USERS (ID, EMAIL, PASSWORD_HASH, CREATED_AT, UPDATED_AT)
       VALUES (:1, :2, :3, SYSDATE, SYSDATE)`,
      [id, dto.email, passwordHash],
    );

    const [user] = await this.dataSource.query<User[]>(
      `SELECT ${USER_SELECT} FROM APP_USERS WHERE ID = :1`,
      [id],
    );

    return this.issueTokenPair(user);
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const [user] = await this.dataSource.query<User[]>(
      `SELECT ${USER_SELECT} FROM APP_USERS WHERE EMAIL = :1 AND ROWNUM = 1`,
      [dto.email],
    );
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.issueTokenPair(user);
  }

  async refresh(refreshToken: string): Promise<AuthResponse> {
    const redisKey = `refresh:${refreshToken}`;
    const payload = await this.redis.get<{ id: string; email: string }>(redisKey);

    if (!payload) {
      throw new UnauthorizedException('Refresh token invalid or expired');
    }

    // Rotate: delete old token before issuing new pair
    await this.redis.del(redisKey);

    const [user] = await this.dataSource.query<User[]>(
      `SELECT ${USER_SELECT} FROM APP_USERS WHERE ID = :1 AND ROWNUM = 1`,
      [payload.id],
    );
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return this.issueTokenPair(user);
  }

  async logout(refreshToken: string): Promise<void> {
    if (refreshToken) {
      await this.redis.del(`refresh:${refreshToken}`);
    }
  }

  private async issueTokenPair(user: User): Promise<AuthResponse> {
    const accessToken = this.jwtService.sign({ sub: user.id, email: user.email });

    const refreshToken = randomUUID();
    await this.redis.set(
      `refresh:${refreshToken}`,
      { id: user.id, email: user.email },
      REFRESH_TTL_SECONDS,
    );

    return {
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email },
    };
  }
}

