import { Module, Global, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TrustIdController } from './trustid.controller';
import { TrustIdService } from './trustid.service';
import { BranchSelectorService } from './branch-selector.service';
import { TrustModule } from '../trust/trust.module';

@Global()
@Module({
  imports: [
    HttpModule.register({
      timeout: 30_000,
      maxRedirects: 3,
    }),
    forwardRef(() => TrustModule),
  ],
  controllers: [TrustIdController],
  providers: [TrustIdService, BranchSelectorService],
  exports: [TrustIdService, BranchSelectorService],
})
export class TrustIdModule {}
