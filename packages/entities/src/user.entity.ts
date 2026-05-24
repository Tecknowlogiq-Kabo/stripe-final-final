import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { Exclude } from 'class-transformer';

export enum UserRole {
  USER = 'user',
  ADMIN = 'admin',
}

@Entity({ name: 'APP_USERS' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'EMAIL', type: 'varchar2', length: 255 })
  email: string;

  @Exclude()
  @Column({ name: 'PASSWORD_HASH', type: 'varchar2', length: 255 })
  passwordHash: string;

  @Column({ name: 'ROLE', type: 'varchar2', length: 20, default: 'user' })
  role: UserRole;

  @CreateDateColumn({ name: 'CREATED_AT', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'UPDATED_AT', type: 'timestamp' })
  updatedAt: Date;
}
