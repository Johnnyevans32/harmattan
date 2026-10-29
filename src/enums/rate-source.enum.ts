export enum RateSource {
  /** Fetched from the live FX provider. */
  LIVE = 'LIVE',
  /** Built-in fixed rate table, used until the provider has ever succeeded. */
  FALLBACK = 'FALLBACK',
}
