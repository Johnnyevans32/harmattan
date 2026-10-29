import {
  createTestApp,
  createUser,
  path,
  type TestContext,
  uniqueEmail,
} from './utils/test-app';

const COINS = ['cNGN', 'cGHS', 'cXAF', 'USDx', 'EURx'];

describe('Users and wallets', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  describe('POST /users', () => {
    it('creates a user with one zero-balance wallet per coin', async () => {
      const email = uniqueEmail();
      const res = await ctx
        .api()
        .post(path('/users'))
        .send({ email })
        .expect(201);

      expect(res.body).toMatchObject({
        code: 201,
        message: 'User created successfully',
      });
      expect(res.body.data).toMatchObject({ email, totalUsd: '0.00' });

      const { wallets } = res.body.data;
      expect(wallets.map((w: { currency: string }) => w.currency)).toEqual(
        COINS,
      );
      wallets.forEach((wallet: Record<string, unknown>) => {
        expect(wallet).toMatchObject({
          userId: res.body.data.id,
          balance: '0.000000',
          usdValue: '0.00',
        });
      });
      expect(new Set(wallets.map((w: { id: string }) => w.id)).size).toBe(5);
    });

    it('creates the user and wallets atomically', async () => {
      await ctx
        .api()
        .post(path('/users'))
        .send({ email: uniqueEmail() })
        .expect(201);
      const [users, wallets] = await Promise.all([
        ctx.connection.collection('users').countDocuments(),
        ctx.connection.collection('wallets').countDocuments(),
      ]);
      expect(wallets).toBe(users * COINS.length);
    });

    it('normalises phone numbers to E.164', async () => {
      const res = await ctx
        .api()
        .post(path('/users'))
        .send({ phone: '+234 803 555 0101' })
        .expect(201);

      expect(res.body.data.phone).toBe('+2348035550101');
    });

    it('rejects a second user for the same email, case-insensitively', async () => {
      const email = uniqueEmail();
      await ctx.api().post(path('/users')).send({ email }).expect(201);

      const res = await ctx
        .api()
        .post(path('/users'))
        .send({ email: email.toUpperCase() })
        .expect(409);
      expect(res.body.message).toBe('A user already exists for this email');
    });

    it('rejects a second user for the same phone in a different format', async () => {
      await ctx
        .api()
        .post(path('/users'))
        .send({ phone: '+233201234567' })
        .expect(201);

      const res = await ctx
        .api()
        .post(path('/users'))
        .send({ email: uniqueEmail(), phone: '+233 20 123 4567' })
        .expect(409);
      expect(res.body.message).toBe('A user already exists for this phone');
    });

    it('creates exactly one user (and one wallet set) under concurrent duplicates', async () => {
      const email = uniqueEmail();
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          ctx.api().post(path('/users')).send({ email }),
        ),
      );

      const statuses = results.map((r) => r.status);
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(7);

      const users = await ctx.connection
        .collection('users')
        .find({ email })
        .toArray();
      expect(users).toHaveLength(1);
      expect(
        await ctx.connection
          .collection('wallets')
          .countDocuments({ userId: users[0]._id }),
      ).toBe(COINS.length);
    });

    it.each<[string, object]>([
      ['neither email nor phone', {}],
      ['an invalid email', { email: 'not-an-email' }],
      ['a phone number without a country code', { phone: '08012345678' }],
      ['unknown fields', { email: uniqueEmail(), role: 'admin' }],
    ])('returns 400 for %s', async (_case, body) => {
      const res = await ctx.api().post(path('/users')).send(body).expect(400);

      expect(res.body.code).toBe(400);
      expect(res.body.message).toBe('Validation failed');
      expect(res.body.errors.length).toBeGreaterThan(0);
    });
  });

  describe('GET /users/:userId', () => {
    it('returns every wallet with its USD value and the total', async () => {
      // Stub rates: 1 USDx = 1600 cNGN = 0.8 EURx
      const user = await createUser(ctx, {
        cNGN: '1600',
        USDx: '10',
        EURx: '8',
      });

      const res = await ctx
        .api()
        .get(path(`/users/${user.id}`))
        .expect(200);
      const byCurrency = Object.fromEntries(
        res.body.data.wallets.map((w: { currency: string }) => [w.currency, w]),
      );

      expect(byCurrency.cNGN).toMatchObject({
        balance: '1600.000000',
        usdValue: '1.00',
      });
      expect(byCurrency.EURx.usdValue).toBe('10.00');
      expect(res.body.data.totalUsd).toBe('21.00');
    });

    it('returns 404 for an unknown user', async () => {
      const res = await ctx
        .api()
        .get(path('/users/6720c0f1a2b3c4d5e6f70812'))
        .expect(404);
      expect(res.body).toEqual({ code: 404, message: 'User not found' });
    });

    it('returns 400 for a malformed id', async () => {
      await ctx.api().get(path('/users/not-an-id')).expect(400);
    });
  });

  describe('GET /wallets/:walletId', () => {
    it('returns a single-currency wallet', async () => {
      const user = await createUser(ctx, { cGHS: '24' });

      const res = await ctx
        .api()
        .get(path(`/wallets/${user.wallets.cGHS}`))
        .expect(200);
      expect(res.body.data).toMatchObject({
        id: user.wallets.cGHS,
        userId: user.id,
        currency: 'cGHS',
        balance: '24.000000',
        usdValue: '2.00',
      });
    });

    it('returns 404 for an unknown wallet', async () => {
      await ctx
        .api()
        .get(path('/wallets/6720c0f1a2b3c4d5e6f70812'))
        .expect(404);
    });
  });
});
