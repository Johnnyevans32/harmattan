import type {
  FxRateProvider,
  UsdRateTable,
} from '@/fx/providers/fx-rate-provider.interface';

/**
 * Deterministic provider. Rates are chosen so most conversions are exact:
 *   1 USDx = 1600 cNGN = 12 cGHS = 625 cXAF = 0.8 EURx
 */
export const STUB_USD_RATES: UsdRateTable = {
  USD: '1',
  NGN: '1600',
  GHS: '12',
  XAF: '625',
  EUR: '0.8',
};

export class StubFxProvider implements FxRateProvider {
  readonly name = 'stub';
  rates: UsdRateTable = { ...STUB_USD_RATES };
  failing = false;
  calls = 0;

  fetchUsdRates(): Promise<UsdRateTable> {
    this.calls += 1;
    return this.failing
      ? Promise.reject(new Error('provider unavailable'))
      : Promise.resolve({ ...this.rates });
  }
}
