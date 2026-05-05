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
import { RegisterDto, LoginDto } from './dto/auth.dto';

const SALT_ROUNDS = 12;

const USER_SELECT = `ID AS "id", EMAIL AS "email", PASSWORD_HASH AS "passwordHash", CREATED_AT AS "createdAt", UPDATED_AT AS "updatedAt"`;

export interface AuthResponse {
  accessToken: string;
  user: { id: string; email: string };
}

@Injectable()
export class AuthService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly jwtService: JwtService,
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

    return this.signToken(user);
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

    return this.signToken(user);
  }

  private signToken(user: User): AuthResponse {
    const payload = { sub: user.id, email: user.email };
    return {
      accessToken: this.jwtService.sign(payload),
      user: { id: user.id, email: user.email },
    };
  }
}
