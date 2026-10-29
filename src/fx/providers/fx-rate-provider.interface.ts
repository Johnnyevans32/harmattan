/** Units of each fiat currency per 1 USD, keyed by ISO 4217 code. */
export type UsdRateTable = Partial<Record<string, string>>;

export interface FxRateProvider {
  readonly name: string;
  fetchUsdRates(): Promise<UsdRateTable>;
}
