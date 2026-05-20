import { Test, TestingModule } from '@nestjs/testing';
import { RadarHandler } from './radar.handler';
import { AuditService } from '../../audit/audit.service';

describe('RadarHandler', () => {
  let handler: RadarHandler;
  let auditService: jest.Mocked<Pick<AuditService, 'log'>>;

  beforeEach(async () => {
    const mockAuditService = { log: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RadarHandler,
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    handler = module.get<RadarHandler>(RadarHandler);
    auditService = module.get(AuditService);
  });

  it('should log fraud warning and create audit entry', async () => {
    const event = {
      id: 'evt_test_007',
      type: 'radar.early_fraud_warning',
      data: {
        object: {
          id: 'issfr_test_001',
          object: 'radar.early_fraud_warning',
          charge: 'ch_test_007',
          actionable: true,
          fraud_type: 'card_never_received',
          livemode: false,
        },
      },
    } as any;

    await handler.handle(event);

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'system:radar',
        action: 'fraud_warning',
        resourceType: 'charge',
        resourceId: 'ch_test_007',
        status: 'failure',
        details: expect.stringContaining('card_never_received'),
      }),
    );
  });

  it('should handle non-actionable fraud warning', async () => {
    const event = {
      id: 'evt_test_008',
      type: 'radar.early_fraud_warning',
      data: {
        object: {
          id: 'issfr_test_002',
          object: 'radar.early_fraud_warning',
          charge: 'ch_test_008',
          actionable: false,
          fraud_type: 'duplicate',
          livemode: false,
        },
      },
    } as any;

    await handler.handle(event);

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'fraud_warning',
        details: expect.stringContaining('"actionable":false'),
      }),
    );
  });
});
