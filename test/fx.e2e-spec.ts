import { FxService } from '@/fx/fx.service';
import { StubFxProvider } from './utils/stub-fx-provider';
import {
  createTestApp,
  createUser,
  idempotencyKey,
  path,
  type TestContext,
} from './utils/test-app';

interface Rate {
  from: string;
  to: string;
  rate: string;
  source: string;
  refreshedAt: string;
  stale: boolean;
}

const findRate = (rates: Rate[], from: string, to: string) =>
  rates.find((r) => r.from === from && r.to === to);

describe('FX rates', () => {
  describe('with a healthy provider', () => {
    let ctx: TestContext;

    beforeAll(async () => {
      ctx = await createTestApp();
    });
    afterAll(() => ctx.close());

    it('returns every pair with its source and refresh time', async () => {
      const res = await ctx.api().get(path('/fx/rates')).expect(200);
      const rates = res.body.data as Rate[];

      expect(rates).toHaveLength(20);
      rates.forEach((rate) => {
        expect(rate.source).toBe('LIVE');
        expect(rate.stale).toBe(false);
        expect(Number.isNaN(Date.parse(rate.refreshedAt))).toBe(false);
      });
      expect(findRate(rates, 'USDx', 'cNGN')?.rate).toBe('1600');
      expect(findRate(rates, 'cXAF', 'EURx')?.rate).toBe('0.00128');
      expect(findRate(rates, 'EURx', 'USDx')?.rate).toBe('1.25');
    });

    it('quotes a conversion', async () => {
      const res = await ctx
        .api()
        .get(path('/fx/quote'))
        .query({ from: 'USDx', to: 'cGHS', amount: '2.5' })
        .expect(200);

      expect(res.body.data).toMatchObject({
        from: 'USDx',
        to: 'cGHS',
        rate: '12',
        amount: '2.500000',
        convertedAmount: '30.000000',
      });
    });

    it('keeps serving the last live rates during a provider outage', async () => {
      ctx.fxProvider.failing = true;
      await ctx.app.get(FxService).refresh();

      const res = await ctx.api().get(path('/fx/rates')).expect(200);
      expect(findRate(res.body.data, 'USDx', 'cNGN')).toMatchObject({
        rate: '1600',
        source: 'LIVE',
      });
      ctx.fxProvider.failing = false;
    });

    it('applies refreshed rates to new swaps', async () => {
      ctx.fxProvider.rates = { ...ctx.fxProvider.rates, NGN: '2000' };
      await ctx.app.get(FxService).refresh();

      const user = await createUser(ctx, { USDx: '1' });
      const res = await ctx
        .api()
        .post(path(`/wallets/${user.wallets.USDx}/swaps`))
        .set('Idempotency-Key', idempotencyKey())
        .send({ toCurrency: 'cNGN', amount: '1' })
        .expect(201);

      expect(res.body.data).toMatchObject({
        rate: '2000',
        destinationAmount: '2000.000000',
      });
    });
  });

  describe('when the provider has never succeeded', () => {
    let ctx: TestContext;

    beforeAll(async () => {
      const provider = new StubFxProvider();
      provider.failing = true;
      ctx = await createTestApp(provider);
    });
    afterAll(() => ctx.close());

    it('falls back to the fixed rate table and flags it', async () => {
      const res = await ctx.api().get(path('/fx/rates')).expect(200);
      expect(findRate(res.body.data, 'USDx', 'cNGN')).toMatchObject({
        rate: '1500',
        source: 'FALLBACK',
        stale: true,
      });
    });

    it('still processes swaps, recording the fallback source', async () => {
      const user = await createUser(ctx, { USDx: '2' });
      const res = await ctx
        .api()
        .post(path(`/wallets/${user.wallets.USDx}/swaps`))
        .set('Idempotency-Key', idempotencyKey())
        .send({ toCurrency: 'cNGN', amount: '2' })
        .expect(201);

      expect(res.body.data).toMatchObject({
        destinationAmount: '3000.000000',
        rateSource: 'FALLBACK',
      });
    });
  });
});
