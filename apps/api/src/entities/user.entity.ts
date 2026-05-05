import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { Exclude } from 'class-transformer';

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

  @CreateDateColumn({ name: 'CREATED_AT', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'UPDATED_AT', type: 'timestamp' })
  updatedAt: Date;
}
