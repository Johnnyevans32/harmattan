import {
  createTestApp,
  createWallet,
  path,
  type TestContext,
  uniqueEmail,
} from './utils/test-app';

describe('Wallets', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  describe('POST /wallets', () => {
    it('creates a wallet with a zero balance in every coin', async () => {
      const email = uniqueEmail();
      const res = await ctx
        .api()
        .post(path('/wallets'))
        .send({ email })
        .expect(201);

      expect(res.body).toMatchObject({
        code: 201,
        message: 'Wallet created successfully',
      });
      expect(res.body.data).toMatchObject({ email, totalUsd: '0.00' });
      expect(res.body.data.balances).toEqual(
        ['cNGN', 'cGHS', 'cXAF', 'USDx', 'EURx'].map((currency) => ({
          currency,
          amount: '0.000000',
          usdValue: '0.00',
        })),
      );
    });

    it('normalises phone numbers to E.164', async () => {
      const res = await ctx
        .api()
        .post(path('/wallets'))
        .send({ phone: '+234 803 555 0101' })
        .expect(201);

      expect(res.body.data.phone).toBe('+2348035550101');
    });

    it('rejects a second wallet for the same email, case-insensitively', async () => {
      const email = uniqueEmail();
      await ctx.api().post(path('/wallets')).send({ email }).expect(201);

      const res = await ctx
        .api()
        .post(path('/wallets'))
        .send({ email: email.toUpperCase() })
        .expect(409);
      expect(res.body.message).toBe('A wallet already exists for this email');
    });

    it('rejects a second wallet for the same phone in a different format', async () => {
      await ctx
        .api()
        .post(path('/wallets'))
        .send({ phone: '+233201234567' })
        .expect(201);

      const res = await ctx
        .api()
        .post(path('/wallets'))
        .send({ email: uniqueEmail(), phone: '+233 20 123 4567' })
        .expect(409);
      expect(res.body.message).toBe('A wallet already exists for this phone');
    });

    it('creates exactly one wallet under concurrent duplicate requests', async () => {
      const email = uniqueEmail();
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          ctx.api().post(path('/wallets')).send({ email }),
        ),
      );

      const statuses = results.map((r) => r.status).sort();
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(7);
    });

    it.each<[string, object]>([
      ['neither email nor phone', {}],
      ['an invalid email', { email: 'not-an-email' }],
      ['a phone number without a country code', { phone: '08012345678' }],
      ['unknown fields', { email: uniqueEmail(), role: 'admin' }],
    ])('returns 400 for %s', async (_case, body) => {
      const res = await ctx.api().post(path('/wallets')).send(body).expect(400);

      expect(res.body.code).toBe(400);
      expect(res.body.message).toBe('Validation failed');
      expect(res.body.errors.length).toBeGreaterThan(0);
    });
  });

  describe('GET /wallets/:walletId', () => {
    it('returns balances with their USD value and the total', async () => {
      // Stub rates: 1 USDx = 1600 cNGN = 0.8 EURx
      const walletId = await createWallet(ctx, {
        cNGN: '1600',
        USDx: '10',
        EURx: '8',
      });

      const res = await ctx
        .api()
        .get(path(`/wallets/${walletId}`))
        .expect(200);
      const byCurrency = Object.fromEntries(
        res.body.data.balances.map((b: { currency: string }) => [
          b.currency,
          b,
        ]),
      );

      expect(byCurrency.cNGN).toEqual({
        currency: 'cNGN',
        amount: '1600.000000',
        usdValue: '1.00',
      });
      expect(byCurrency.EURx.usdValue).toBe('10.00');
      expect(res.body.data.totalUsd).toBe('21.00');
    });

    it('returns 404 for an unknown wallet', async () => {
      const res = await ctx
        .api()
        .get(path('/wallets/6720c0f1a2b3c4d5e6f70812'))
        .expect(404);
      expect(res.body).toEqual({ code: 404, message: 'Wallet not found' });
    });

    it('returns 400 for a malformed id', async () => {
      await ctx.api().get(path('/wallets/not-an-id')).expect(400);
    });
  });
});
