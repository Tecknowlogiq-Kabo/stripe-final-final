import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { MetricsAccessGuard } from '../common/guards/metrics-access.guard';
import { MetricsService } from './metrics.service';

/**
 * Prometheus scrape endpoint — only accessible from localhost / Docker.
 * @Public() bypasses global JwtAuthGuard (Prometheus can't authenticate).
 * @UseGuards(MetricsAccessGuard) restricts to internal IPs only.
 */
@Controller('metrics')
@Public()
@UseGuards(MetricsAccessGuard)
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  async getMetrics(@Res() res: Response): Promise<void> {
    res.set('Content-Type', 'text/plain');
    res.send(await this.metricsService.getMetrics());
  }
}
