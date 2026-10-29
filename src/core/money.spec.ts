import { Types } from 'mongoose';
import { Stablecoin } from '@/enums/stablecoin.enum';
import {
  convert,
  formatAmount,
  Money,
  roundRate,
  roundToUnit,
  toDecimal128,
  toMoney,
} from './money';

describe('money', () => {
  it('does exact decimal arithmetic (no binary float drift)', () => {
    expect(toMoney('0.1').add('0.2').toFixed()).toBe('0.3');
  });

  it('round-trips through Decimal128 without loss', () => {
    const value = toMoney('123456789012.123456');
    const stored = toDecimal128(value);

    expect(stored).toBeInstanceOf(Types.Decimal128);
    expect(toMoney(stored).eq(value)).toBe(true);
  });

  it('formats to the coin precision and never uses exponent notation', () => {
    expect(formatAmount('1500', Stablecoin.CNGN)).toBe('1500.000000');
    expect(formatAmount('0.0000001', Stablecoin.USDX)).toBe('0.000000');
    expect(formatAmount('1e21', Stablecoin.USDX)).toBe(
      '1000000000000000000000.000000',
    );
  });

  it('truncates to the smallest unit instead of rounding up', () => {
    expect(roundToUnit(toMoney('1.9999999'), Stablecoin.USDX).toFixed()).toBe(
      '1.999999',
    );
  });

  it('rounds rates to 12 significant digits', () => {
    expect(roundRate(toMoney(1600).div(12)).toFixed()).toBe('133.333333333');
    expect(roundRate(toMoney(1).div(3)).toFixed()).toBe('0.333333333333');
  });

  it('converts with a reproducible, truncated result', () => {
    const rate = roundRate(toMoney(12).div(1600)); // cNGN -> cGHS
    expect(convert(toMoney('1600'), rate, Stablecoin.CGHS).toFixed()).toBe(
      '12',
    );
    expect(convert(toMoney('1'), rate, Stablecoin.CGHS).toFixed()).toBe(
      '0.0075',
    );
    expect(
      convert(
        new Money('0.000001'),
        toMoney('0.000625'),
        Stablecoin.USDX,
      ).isZero(),
    ).toBe(true);
  });
});
