import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TrustController } from './trust.controller';
import { TrustService } from './trust.service';
import { TrustRepository } from './trust.repository';
import { TrustGuard } from './trust.guard';
import { S3Module } from '../s3/s3.module';
import { TrustIdModule } from '../trustid/trustid.module';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('trust.jwtSecret'),
        signOptions: { expiresIn: config.get<number>('trust.tokenTtlSeconds') ?? 86400 },
      }),
      inject: [ConfigService],
    }),
    S3Module,
    TrustIdModule,
  ],
  controllers: [TrustController],
  providers: [TrustService, TrustRepository, TrustGuard],
  exports: [TrustService, TrustGuard, TrustRepository],
})
export class TrustModule {}
