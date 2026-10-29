import { applyDecorators } from '@nestjs/common';
import {
  IsString,
  Matches,
  ValidateBy,
  type ValidationOptions,
} from 'class-validator';
import { MAX_AMOUNT } from '@/core/constants';
import { toMoney } from '@/core/money';

/** Plain positive decimal: no sign, no exponent, no leading zeros. */
const AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/;

/**
 * Money is accepted only as a decimal string ("1500.25") so it can never pass
 * through a binary float. Per-currency precision is enforced in the service.
 */
export const IsAmount = (options?: ValidationOptions) =>
  applyDecorators(
    IsString({ ...options, message: '$property must be a decimal string' }),
    Matches(AMOUNT_PATTERN, {
      ...options,
      message: '$property must be a positive decimal string, e.g. "100.50"',
    }),
    ValidateBy(
      {
        name: 'isAmountInRange',
        validator: {
          validate: (value: unknown) =>
            typeof value === 'string' &&
            AMOUNT_PATTERN.test(value) &&
            toMoney(value).gt(0) &&
            toMoney(value).lte(MAX_AMOUNT),
          defaultMessage: () =>
            `$property must be greater than 0 and at most ${MAX_AMOUNT}`,
        },
      },
      options,
    ),
  );
