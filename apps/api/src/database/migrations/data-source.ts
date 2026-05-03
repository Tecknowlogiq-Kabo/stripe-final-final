import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { join } from 'path';

dotenv.config({ path: join(__dirname, '../../../.env') });

export const AppDataSource = new DataSource({
  type: 'oracle',
  username: process.env.ORACLE_USER,
  password: process.env.ORACLE_PASSWORD,
  host: process.env.ORACLE_HOST ?? 'localhost',
  port: Number(process.env.ORACLE_PORT ?? 1521),
  serviceName: process.env.ORACLE_SERVICE_NAME ?? 'XEPDB1',
  entities: [join(__dirname, '../../entities/*.entity{.ts,.js}')],
  migrations: [join(__dirname, './*{.ts,.js}')],
  synchronize: false,
  logging: true,
});
