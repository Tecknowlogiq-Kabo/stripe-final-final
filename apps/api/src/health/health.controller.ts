import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
  HttpHealthIndicator,
  HealthCheckResult,
} from '@nestjs/terminus';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly http: HttpHealthIndicator,
  ) {}

  @Public()
  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.db.pingCheck('oracle-database'),
      () =>
        this.http.pingCheck(
          'stripe-api',
          'https://api.stripe.com/healthcheck',
        ),
    ]);
  }
}
