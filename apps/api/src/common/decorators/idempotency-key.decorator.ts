import {
  createParamDecorator,
  ExecutionContext,
  BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';

/**
 * Extracts the Idempotency-Key header from the request.
 * Throws 400 if the header is missing.
 *
 * Usage: @IdempotencyKey() idempotencyKey: string
 */
export const IdempotencyKey = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const key =
      request.headers['idempotency-key'] ??
      request.headers['Idempotency-Key'];

    if (!key) {
      throw new BadRequestException('Idempotency-Key header is required');
    }

    return key as string;
  },
);
