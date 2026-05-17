import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { User } from '../entities/user.entity';
import { USER_SELECT } from '../database/query-constants';

@Injectable()
export class UsersRepository {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async findByEmail(email: string): Promise<User | null> {
    const [user] = await this.dataSource.query<User[]>(
      `SELECT ${USER_SELECT} FROM APP_USERS WHERE EMAIL = :1 AND ROWNUM = 1`,
      [email],
    );
    return user ?? null;
  }

  async findById(id: string): Promise<User | null> {
    const [user] = await this.dataSource.query<User[]>(
      `SELECT ${USER_SELECT} FROM APP_USERS WHERE ID = :1 AND ROWNUM = 1`,
      [id],
    );
    return user ?? null;
  }

  async insert(id: string, email: string, passwordHash: string): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO APP_USERS (ID, EMAIL, PASSWORD_HASH, CREATED_AT, UPDATED_AT)
       VALUES (:1, :2, :3, SYSDATE, SYSDATE)`,
      [id, email, passwordHash],
    );
  }
}
