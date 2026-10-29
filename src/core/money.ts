import Decimal from 'decimal.js';
import { Types } from 'mongoose';
import { Stablecoin } from '@/enums/stablecoin.enum';
import { STABLECOIN_CONFIG } from './constants';

/**
 * All money arithmetic goes through this isolated Decimal constructor:
 * arbitrary precision, no binary floating point, never exponent notation.
 * Amounts are persisted as Decimal128 and travel over the wire as strings.
 */
export const Money = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_DOWN,
  toExpNeg: -40,
  toExpPos: 40,
});
export type Money = Decimal;

/** FX rates are carried to 12 significant digits. */
const RATE_SIGNIFICANT_DIGITS = 12;

export const decimalsOf = (currency: Stablecoin): number =>
  STABLECOIN_CONFIG[currency].decimals;

export const toMoney = (value: Decimal.Value | Types.Decimal128): Money =>
  new Money(value instanceof Types.Decimal128 ? value.toString() : value);

export const toDecimal128 = (value: Money): Types.Decimal128 =>
  Types.Decimal128.fromString(value.toFixed());

/** Truncate to the currency's smallest unit (never rounds in the user's favour). */
export const roundToUnit = (value: Money, currency: Stablecoin): Money =>
  value.toDecimalPlaces(decimalsOf(currency), Decimal.ROUND_DOWN);

export const formatAmount = (
  value: Decimal.Value | Types.Decimal128,
  currency: Stablecoin,
): string =>
  roundToUnit(toMoney(value), currency).toFixed(decimalsOf(currency));

export const roundRate = (value: Money): Money =>
  value.toSignificantDigits(RATE_SIGNIFICANT_DIGITS, Decimal.ROUND_HALF_EVEN);

/**
 * Converts using the exact (already rounded) rate that gets recorded, so
 * `destination = roundToUnit(source * rate)` is reproducible from the ledger.
 */
export const convert = (
  amount: Money,
  rate: Money,
  destination: Stablecoin,
): Money => roundToUnit(amount.mul(rate), destination);
