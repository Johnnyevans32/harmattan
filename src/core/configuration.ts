const int = (value: string | undefined, fallback: number) => {
  const parsed = parseInt(value ?? '', 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

export default () => ({
  env: process.env.NODE_ENV ?? 'development',
  port: int(process.env.PORT, 3000),
  app: {
    name: 'Harmattan',
    description: 'Stablecoin-powered cross-border payments sandbox',
  },
  database: {
    url:
      process.env.DB_URL ??
      'mongodb://localhost:27017/harmattan?directConnection=true',
  },
  fx: {
    providerUrl:
      process.env.FX_PROVIDER_URL ?? 'https://open.er-api.com/v6/latest/USD',
    providerTimeoutMs: int(process.env.FX_PROVIDER_TIMEOUT_MS, 5_000),
    // 0 disables the background refresh loop (used in tests).
    refreshIntervalMs: int(process.env.FX_REFRESH_INTERVAL_MS, 10 * 60_000),
    // Rates older than this are flagged `stale` in API responses.
    maxRateAgeMs: int(process.env.FX_MAX_RATE_AGE_MS, 24 * 60 * 60_000),
  },

  isTest: () => process.env.NODE_ENV === 'test',
  isDev: () => process.env.NODE_ENV === 'development',
  isProd: () => process.env.NODE_ENV === 'production',
});
