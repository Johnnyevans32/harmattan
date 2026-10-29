import { Stablecoin } from '@/enums/stablecoin.enum';

export const DB_TABLE_NAMES = {
  USERS: 'users',
  WALLETS: 'wallets',
  TRANSACTIONS: 'transactions',
  FX_RATES: 'fx_rates',
} as const;

export const FX_RATE_PROVIDER = Symbol('FX_RATE_PROVIDER');

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
export const IDEMPOTENT_REPLAY_HEADER = 'Idempotent-Replayed';

/** USDx is the valuation currency for portfolio totals. */
export const VALUATION_CURRENCY = Stablecoin.USDX;

export interface StablecoinConfig {
  name: string;
  /** ISO 4217 code of the fiat currency the coin is pegged to. */
  fiat: string;
  /** Smallest representable unit is 10^-decimals. */
  decimals: number;
}

export const STABLECOIN_CONFIG: Record<Stablecoin, StablecoinConfig> = {
  [Stablecoin.CNGN]: { name: 'Nigerian Naira Coin', fiat: 'NGN', decimals: 6 },
  [Stablecoin.CGHS]: { name: 'Ghanaian Cedi Coin', fiat: 'GHS', decimals: 6 },
  [Stablecoin.CXAF]: {
    name: 'Central African CFA Coin',
    fiat: 'XAF',
    decimals: 6,
  },
  [Stablecoin.USDX]: { name: 'US Dollar Coin', fiat: 'USD', decimals: 6 },
  [Stablecoin.EURX]: { name: 'Euro Coin', fiat: 'EUR', decimals: 6 },
};

/**
 * Indicative units-per-USD table, used only until the live provider has
 * succeeded at least once. Reported with source FALLBACK so it is never
 * mistaken for a live quote.
 */
export const FALLBACK_USD_RATES: Record<Stablecoin, string> = {
  [Stablecoin.USDX]: '1',
  [Stablecoin.EURX]: '0.86',
  [Stablecoin.CNGN]: '1500',
  [Stablecoin.CGHS]: '11.5',
  [Stablecoin.CXAF]: '565',
};
export const FALLBACK_RATES_AS_OF = new Date('2026-10-01T00:00:00.000Z');

/** Upper bound on any single amount, guarding against absurd input. */
export const MAX_AMOUNT = '1000000000000';
