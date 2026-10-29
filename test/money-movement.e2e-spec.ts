import {
  createTestApp,
  createUser,
  getBalances,
  idempotencyKey,
  path,
  type TestContext,
} from './utils/test-app';

describe('Money movement', () => {
  let ctx: TestContext;

  const post = (walletId: string, route: string, body: object) =>
    ctx
      .api()
      .post(path(`/wallets/${walletId}/${route}`))
      .set('Idempotency-Key', idempotencyKey())
      .send(body);

  const transactionCount = () =>
    ctx.connection.collection('transactions').countDocuments();

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  describe('POST /wallets/:walletId/deposits', () => {
    it('credits the wallet in its own currency and records the deposit', async () => {
      const user = await createUser(ctx);

      const res = await post(user.wallets.cGHS, 'deposits', {
        amount: '250.75',
      }).expect(201);

      expect(res.body.message).toBe('Deposit successful');
      expect(res.body.data).toMatchObject({
        type: 'DEPOSIT',
        senderUserId: null,
        senderWalletId: null,
        receiverUserId: user.id,
        receiverWalletId: user.wallets.cGHS,
        sourceCurrency: 'cGHS',
        sourceAmount: '250.750000',
        destinationCurrency: 'cGHS',
        destinationAmount: '250.750000',
        rate: '1',
        rateSource: null,
      });
      expect((await getBalances(ctx, user.id)).cGHS).toBe('250.750000');
    });

    it('adds exactly, with no floating point drift', async () => {
      const user = await createUser(ctx);
      for (let i = 0; i < 10; i++) {
        await post(user.wallets.USDx, 'deposits', { amount: '0.1' }).expect(
          201,
        );
      }
      expect((await getBalances(ctx, user.id)).USDx).toBe('1.000000');
    });

    it.each<[string, object]>([
      ['more than 6 decimals', { amount: '1.0000001' }],
      ['zero', { amount: '0' }],
      ['a negative amount', { amount: '-5' }],
      ['a JSON number', { amount: 10 }],
      ['exponent notation', { amount: '1e3' }],
      ['an amount above the cap', { amount: '1000000000001' }],
      [
        'a currency field (implied by the wallet)',
        { amount: '1', currency: 'USDx' },
      ],
    ])('rejects %s', async (_case, body) => {
      const user = await createUser(ctx);
      await post(user.wallets.USDx, 'deposits', body).expect(400);
      expect((await getBalances(ctx, user.id)).USDx).toBe('0.000000');
    });

    it('requires an Idempotency-Key header', async () => {
      const user = await createUser(ctx);
      const res = await ctx
        .api()
        .post(path(`/wallets/${user.wallets.USDx}/deposits`))
        .send({ amount: '1' })
        .expect(400);
      expect(res.body.message).toBe('Idempotency-Key header is required');
    });

    it('returns 404 for an unknown wallet', async () => {
      await post('6720c0f1a2b3c4d5e6f70812', 'deposits', {
        amount: '1',
      }).expect(404);
    });
  });

  describe('POST /wallets/:walletId/swaps', () => {
    it("converts into the same user's other wallet at the current rate", async () => {
      const user = await createUser(ctx, { cNGN: '20000' });

      const res = await post(user.wallets.cNGN, 'swaps', {
        toCurrency: 'USDx',
        amount: '16000',
      }).expect(201);

      expect(res.body.data).toMatchObject({
        type: 'SWAP',
        senderUserId: user.id,
        senderWalletId: user.wallets.cNGN,
        receiverUserId: user.id,
        receiverWalletId: user.wallets.USDx,
        sourceAmount: '16000.000000',
        destinationCurrency: 'USDx',
        destinationAmount: '10.000000',
        rate: '0.000625',
        rateSource: 'LIVE',
      });
      expect(res.body.data.rateRefreshedAt).toEqual(expect.any(String));

      expect(await getBalances(ctx, user.id)).toMatchObject({
        cNGN: '4000.000000',
        USDx: '10.000000',
      });
    });

    it('truncates the destination amount to the smallest unit', async () => {
      const user = await createUser(ctx, { cGHS: '100' });

      const res = await post(user.wallets.cGHS, 'swaps', {
        toCurrency: 'cNGN',
        amount: '100',
      }).expect(201);

      // 1600 / 12 = 133.333333333 (12 significant digits) -> 13333.3333333 -> truncated
      expect(res.body.data.rate).toBe('133.333333333');
      expect(res.body.data.destinationAmount).toBe('13333.333333');
    });

    it('rejects a swap that would make the balance negative', async () => {
      const user = await createUser(ctx, { cNGN: '100' });
      const before = await transactionCount();

      const res = await post(user.wallets.cNGN, 'swaps', {
        toCurrency: 'USDx',
        amount: '100.000001',
      }).expect(422);

      expect(res.body.message).toBe('Insufficient cNGN balance');
      expect(await getBalances(ctx, user.id)).toMatchObject({
        cNGN: '100.000000',
        USDx: '0.000000',
      });
      expect(await transactionCount()).toBe(before);
    });

    it('rejects an amount too small to produce any destination units', async () => {
      const user = await createUser(ctx, { cNGN: '1' });
      const res = await post(user.wallets.cNGN, 'swaps', {
        toCurrency: 'USDx',
        amount: '0.000001',
      }).expect(400);
      expect(res.body.message).toBe('Amount is too small to convert into USDx');
    });

    it("rejects swapping into the wallet's own coin", async () => {
      const user = await createUser(ctx, { USDx: '10' });
      await post(user.wallets.USDx, 'swaps', {
        toCurrency: 'USDx',
        amount: '1',
      }).expect(400);
    });
  });

  describe('POST /wallets/:walletId/transfers', () => {
    it('moves funds between users in the same currency', async () => {
      const sender = await createUser(ctx, { cNGN: '1000' });
      const receiver = await createUser(ctx);

      const res = await post(sender.wallets.cNGN, 'transfers', {
        recipientWalletId: receiver.wallets.cNGN,
        amount: '400',
      }).expect(201);

      expect(res.body.data).toMatchObject({
        type: 'TRANSFER',
        senderUserId: sender.id,
        senderWalletId: sender.wallets.cNGN,
        receiverUserId: receiver.id,
        receiverWalletId: receiver.wallets.cNGN,
        sourceCurrency: 'cNGN',
        sourceAmount: '400.000000',
        destinationCurrency: 'cNGN',
        destinationAmount: '400.000000',
        rate: '1',
        rateSource: null,
      });
      expect((await getBalances(ctx, sender.id)).cNGN).toBe('600.000000');
      expect((await getBalances(ctx, receiver.id)).cNGN).toBe('400.000000');
    });

    it("converts automatically into the recipient wallet's currency", async () => {
      const sender = await createUser(ctx, { cNGN: '5000' });
      const receiver = await createUser(ctx);

      const res = await post(sender.wallets.cNGN, 'transfers', {
        recipientWalletId: receiver.wallets.cGHS,
        amount: '1600',
      }).expect(201);

      expect(res.body.data).toMatchObject({
        sourceAmount: '1600.000000',
        destinationCurrency: 'cGHS',
        destinationAmount: '12.000000',
        rate: '0.0075',
        rateSource: 'LIVE',
      });
      expect((await getBalances(ctx, sender.id)).cNGN).toBe('3400.000000');
      expect((await getBalances(ctx, receiver.id)).cGHS).toBe('12.000000');
    });

    it('changes nothing when the recipient does not exist', async () => {
      const sender = await createUser(ctx, { USDx: '50' });
      const before = await transactionCount();

      const res = await post(sender.wallets.USDx, 'transfers', {
        recipientWalletId: '6720c0f1a2b3c4d5e6f70812',
        amount: '20',
      }).expect(404);

      expect(res.body.message).toBe('Recipient wallet not found');
      expect((await getBalances(ctx, sender.id)).USDx).toBe('50.000000');
      expect(await transactionCount()).toBe(before);
    });

    it('rejects a transfer exceeding the balance', async () => {
      const sender = await createUser(ctx, { USDx: '5' });
      const receiver = await createUser(ctx);

      await post(sender.wallets.USDx, 'transfers', {
        recipientWalletId: receiver.wallets.USDx,
        amount: '5.01',
      }).expect(422);
      expect((await getBalances(ctx, receiver.id)).USDx).toBe('0.000000');
    });

    it('rejects a transfer to the same wallet', async () => {
      const user = await createUser(ctx, { USDx: '5' });
      await post(user.wallets.USDx, 'transfers', {
        recipientWalletId: user.wallets.USDx,
        amount: '1',
      }).expect(400);
    });

    it("rejects a transfer between a user's own wallets", async () => {
      const user = await createUser(ctx, { USDx: '5' });
      const res = await post(user.wallets.USDx, 'transfers', {
        recipientWalletId: user.wallets.EURx,
        amount: '1',
      }).expect(400);
      expect(res.body.message).toBe(
        'Cannot transfer between your own wallets; use a swap instead',
      );
    });
  });
});
