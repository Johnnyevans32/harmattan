import { Logger } from '@nestjs/common';
import type { Model } from 'mongoose';
import { FALLBACK_RATES_AS_OF } from '@/core/constants';
import { toDecimal128, toMoney } from '@/core/money';
import { RateSource } from '@/enums/rate-source.enum';
import { Stablecoin } from '@/enums/stablecoin.enum';
import { FxService } from './fx.service';
import type {
  FxRateProvider,
  UsdRateTable,
} from './providers/fx-rate-provider.interface';
import type { FxRateDocument } from './schemas/fx-rate.schema';

const LIVE_TABLE: UsdRateTable = {
  USD: '1',
  NGN: '1600',
  GHS: '12',
  XAF: '625',
  EUR: '0.8',
};

const setup = (persisted: Partial<FxRateDocument>[] = []) => {
  const model = {
    find: jest.fn(() => ({ lean: jest.fn().mockResolvedValue(persisted) })),
    bulkWrite: jest.fn().mockResolvedValue({}),
  };
  const provider: jest.Mocked<FxRateProvider> = {
    name: 'mock',
    fetchUsdRates: jest.fn().mockResolvedValue(LIVE_TABLE),
  };
  const service = new FxService(
    model as unknown as Model<FxRateDocument>,
    provider,
  );
  return { service, model, provider };
};

describe('FxService', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterAll(() => jest.restoreAllMocks());

  it('crosses live rates through USD and persists them', async () => {
    const { service, model } = setup();
    await service.onModuleInit();

    const pair = service.getRate(Stablecoin.CNGN, Stablecoin.CGHS);
    expect(pair.rate.toFixed()).toBe('0.0075');
    expect(pair.source).toBe(RateSource.LIVE);
    expect(
      service.getRate(Stablecoin.USDX, Stablecoin.CNGN).rate.toFixed(),
    ).toBe('1600');
    expect(model.bulkWrite).toHaveBeenCalledTimes(1);
  });

  it('falls back to the fixed table when the provider has never succeeded', async () => {
    const { service, provider } = setup();
    provider.fetchUsdRates.mockRejectedValue(new Error('timeout'));
    await service.onModuleInit();

    const pair = service.getRate(Stablecoin.USDX, Stablecoin.CNGN);
    expect(pair.rate.toFixed()).toBe('1500');
    expect(pair.source).toBe(RateSource.FALLBACK);
    expect(pair.refreshedAt).toEqual(FALLBACK_RATES_AS_OF);
    expect(service.toResponse(pair).stale).toBe(true);
  });

  it('prefers the persisted last-known-good rate over the fixed table', async () => {
    const refreshedAt = new Date(Date.now() - 60_000);
    const { service, provider } = setup([
      {
        currency: Stablecoin.CNGN,
        unitsPerUsd: toDecimal128(toMoney('1550')),
        source: RateSource.LIVE,
        refreshedAt,
      },
    ]);
    provider.fetchUsdRates.mockRejectedValue(new Error('down'));
    await service.onModuleInit();

    const pair = service.getRate(Stablecoin.USDX, Stablecoin.CNGN);
    expect(pair.rate.toFixed()).toBe('1550');
    expect(pair.source).toBe(RateSource.FALLBACK); // USDx leg is still the table
    expect(service.getRate(Stablecoin.CNGN, Stablecoin.CNGN).source).toBe(
      RateSource.LIVE,
    );
  });

  it('keeps serving the last live rates during an outage', async () => {
    const { service, provider } = setup();
    await service.onModuleInit();
    provider.fetchUsdRates.mockRejectedValue(new Error('503'));
    await service.refresh();

    const pair = service.getRate(Stablecoin.USDX, Stablecoin.EURX);
    expect(pair.rate.toFixed()).toBe('0.8');
    expect(pair.source).toBe(RateSource.LIVE);
  });

  it('ignores missing or invalid values per currency', async () => {
    const { service, provider } = setup();
    provider.fetchUsdRates.mockResolvedValue({
      ...LIVE_TABLE,
      XAF: undefined,
      GHS: '-3',
    });
    await service.onModuleInit();

    expect(service.getRate(Stablecoin.USDX, Stablecoin.CXAF).source).toBe(
      RateSource.FALLBACK,
    );
    expect(
      service.getRate(Stablecoin.USDX, Stablecoin.CGHS).rate.toFixed(),
    ).toBe('11.5');
    expect(service.getRate(Stablecoin.USDX, Stablecoin.CNGN).source).toBe(
      RateSource.LIVE,
    );
  });

  it('shares one provider call between concurrent refreshes', async () => {
    const { service, provider } = setup();
    await Promise.all([
      service.refresh(),
      service.refresh(),
      service.refresh(),
    ]);
    expect(provider.fetchUsdRates).toHaveBeenCalledTimes(1);
  });

  it('lists every ordered pair', async () => {
    const { service } = setup();
    await service.onModuleInit();
    expect(service.getAllRates()).toHaveLength(20);
  });
});
