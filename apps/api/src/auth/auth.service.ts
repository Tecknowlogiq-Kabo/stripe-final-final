import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { User } from '../entities/user.entity';
import { RegisterDto, LoginDto } from './dto/auth.dto';
import { TokenService } from './token.service';
import { USER_SELECT } from '../database/query-constants';

const SALT_ROUNDS = 12;

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
    private readonly tokenService: TokenService,
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

    return this.buildAuthResponse(user);
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

    return this.buildAuthResponse(user);
  }

  async refresh(refreshToken: string): Promise<AuthResponse> {
    const payload = await this.tokenService.validateRefreshToken(refreshToken);
    if (!payload) {
      throw new UnauthorizedException('Refresh token invalid or expired');
    }

    // Rotate: revoke old token before issuing new pair
    await this.tokenService.revokeRefreshToken(refreshToken);

    const [user] = await this.dataSource.query<User[]>(
      `SELECT ${USER_SELECT} FROM APP_USERS WHERE ID = :1 AND ROWNUM = 1`,
      [payload.id],
    );
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return this.buildAuthResponse(user);
  }

  async logout(refreshToken: string): Promise<void> {
    if (refreshToken) {
      await this.tokenService.revokeRefreshToken(refreshToken);
    }
  }

  private async buildAuthResponse(user: User): Promise<AuthResponse> {
    const { accessToken, refreshToken } = await this.tokenService.issueTokenPair(user);
    return { accessToken, refreshToken, user: { id: user.id, email: user.email } };
  }
}
