import {
  applyDecorators,
  BadRequestException,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import type { Request } from 'express';
import { IDEMPOTENCY_KEY_HEADER } from '@/core/constants';

const KEY_PATTERN = /^[A-Za-z0-9_\-:.]{8,128}$/;

/** Extracts and validates the `Idempotency-Key` header. */
export const IdempotencyKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const key = ctx
      .switchToHttp()
      .getRequest<Request>()
      .header(IDEMPOTENCY_KEY_HEADER)
      ?.trim();

    if (!key) {
      throw new BadRequestException(
        `${IDEMPOTENCY_KEY_HEADER} header is required`,
      );
    }
    if (!KEY_PATTERN.test(key)) {
      throw new BadRequestException(
        `${IDEMPOTENCY_KEY_HEADER} must be 8-128 characters of [A-Za-z0-9_-:.] (a UUID is ideal)`,
      );
    }
    return key;
  },
);

export const ApiIdempotencyKey = () =>
  applyDecorators(
    ApiHeader({
      name: IDEMPOTENCY_KEY_HEADER,
      required: true,
      description:
        'Client-generated unique key (UUID recommended). Retrying with the same key and payload returns the original transaction instead of moving money twice.',
      schema: {
        type: 'string',
        example: '7f9c2ba4-e88f-4c3b-9d1a-2f4e6b8a0c11',
      },
    }),
  );
