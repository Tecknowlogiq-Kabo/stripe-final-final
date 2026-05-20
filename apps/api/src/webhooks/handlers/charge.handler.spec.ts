import { Test, TestingModule } from '@nestjs/testing';
import { ChargeHandler } from './charge.handler';
import { AuditService } from '../../audit/audit.service';

describe('ChargeHandler', () => {
  let handler: ChargeHandler;
  let auditService: jest.Mocked<Pick<AuditService, 'log'>>;

  beforeEach(async () => {
    const mockAuditService = { log: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChargeHandler,
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    handler = module.get<ChargeHandler>(ChargeHandler);
    auditService = module.get(AuditService);
  });

  describe('charge.succeeded', () => {
    it('should log charge succeeded event', async () => {
      const event = {
        id: 'evt_test_001',
        type: 'charge.succeeded',
        data: {
          object: {
            id: 'ch_test_001',
            object: 'charge',
            amount: 2000,
            currency: 'usd',
            payment_intent: 'pi_test_001',
            payment_method: 'pm_test_001',
            status: 'succeeded',
          },
        },
      } as any;

      await expect(handler.handle(event)).resolves.toBeUndefined();
    });
  });

  describe('charge.failed', () => {
    it('should log charge failed and create audit entry', async () => {
      const event = {
        id: 'evt_test_002',
        type: 'charge.failed',
        data: {
          object: {
            id: 'ch_test_002',
            object: 'charge',
            amount: 2000,
            currency: 'usd',
            payment_intent: 'pi_test_002',
            status: 'failed',
            failure_code: 'card_declined',
            failure_message: 'Your card was declined.',
            outcome: {
              network_status: 'declined_by_network',
              reason: 'generic_decline',
            },
          },
        },
      } as any;

      await handler.handle(event);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'system:webhook',
          action: 'charge.failed',
          resourceType: 'charge',
          resourceId: 'ch_test_002',
          status: 'failure',
        }),
      );
    });
  });

  describe('charge.refunded', () => {
    it('should log charge refunded event', async () => {
      const event = {
        id: 'evt_test_003',
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_test_003',
            object: 'charge',
            amount: 2000,
            amount_refunded: 2000,
            currency: 'usd',
            payment_intent: 'pi_test_003',
            status: 'succeeded',
          },
        },
      } as any;

      await expect(handler.handle(event)).resolves.toBeUndefined();
    });
  });

  describe('charge.dispute.created', () => {
    it('should log and audit dispute created', async () => {
      const event = {
        id: 'evt_test_004',
        type: 'charge.dispute.created',
        data: {
          object: {
            id: 'dp_test_001',
            object: 'dispute',
            charge: 'ch_test_004',
            reason: 'fraudulent',
            status: 'needs_response',
            amount: 2000,
            currency: 'usd',
            evidence_details: { due_by: 1710000000 },
          },
        },
      } as any;

      await handler.handle(event);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'dispute.created',
          resourceType: 'charge',
          status: 'failure',
        }),
      );
    });
  });

  describe('charge.dispute.closed', () => {
    it('should log and audit dispute closed', async () => {
      const event = {
        id: 'evt_test_005',
        type: 'charge.dispute.closed',
        data: {
          object: {
            id: 'dp_test_002',
            object: 'dispute',
            charge: 'ch_test_005',
            reason: 'product_not_received',
            status: 'won',
            amount: 2000,
            currency: 'usd',
          },
        },
      } as any;

      await handler.handle(event);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'dispute.closed',
          resourceType: 'charge',
          status: 'success',
        }),
      );
    });
  });

  describe('charge.dispute.updated', () => {
    it('should log and audit dispute updated with previous attributes', async () => {
      const event = {
        id: 'evt_test_006',
        type: 'charge.dispute.updated',
        data: {
          object: {
            id: 'dp_test_003',
            object: 'dispute',
            charge: 'ch_test_006',
            reason: 'general',
            status: 'under_review',
            amount: 2000,
            currency: 'usd',
          },
          previous_attributes: { status: 'needs_response' },
        },
      } as any;

      await handler.handle(event);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'dispute.updated',
          resourceType: 'charge',
        }),
      );
    });
  });
});
