import {
  createTestApp,
  createWallet,
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
    it('credits the wallet immediately and records the deposit', async () => {
      const walletId = await createWallet(ctx);

      const res = await post(walletId, 'deposits', {
        currency: 'cGHS',
        amount: '250.75',
      }).expect(201);

      expect(res.body.message).toBe('Deposit successful');
      expect(res.body.data).toMatchObject({
        type: 'DEPOSIT',
        senderWalletId: null,
        receiverWalletId: walletId,
        sourceCurrency: 'cGHS',
        sourceAmount: '250.750000',
        destinationCurrency: 'cGHS',
        destinationAmount: '250.750000',
        rate: '1',
        rateSource: null,
      });
      expect((await getBalances(ctx, walletId)).cGHS).toBe('250.750000');
    });

    it('adds exactly, with no floating point drift', async () => {
      const walletId = await createWallet(ctx);
      for (let i = 0; i < 10; i++) {
        await post(walletId, 'deposits', {
          currency: 'USDx',
          amount: '0.1',
        }).expect(201);
      }
      expect((await getBalances(ctx, walletId)).USDx).toBe('1.000000');
    });

    it.each([
      ['more than 6 decimals', { currency: 'USDx', amount: '1.0000001' }],
      ['zero', { currency: 'USDx', amount: '0' }],
      ['a negative amount', { currency: 'USDx', amount: '-5' }],
      ['a JSON number', { currency: 'USDx', amount: 10 }],
      ['exponent notation', { currency: 'USDx', amount: '1e3' }],
      [
        'an amount above the cap',
        { currency: 'USDx', amount: '1000000000001' },
      ],
      ['an unsupported coin', { currency: 'BTC', amount: '1' }],
    ])('rejects %s', async (_case, body) => {
      const walletId = await createWallet(ctx);
      await post(walletId, 'deposits', body).expect(400);
      expect((await getBalances(ctx, walletId)).USDx).toBe('0.000000');
    });

    it('requires an Idempotency-Key header', async () => {
      const walletId = await createWallet(ctx);
      const res = await ctx
        .api()
        .post(path(`/wallets/${walletId}/deposits`))
        .send({ currency: 'USDx', amount: '1' })
        .expect(400);
      expect(res.body.message).toBe('Idempotency-Key header is required');
    });

    it('returns 404 for an unknown wallet', async () => {
      await post('6720c0f1a2b3c4d5e6f70812', 'deposits', {
        currency: 'USDx',
        amount: '1',
      }).expect(404);
    });
  });

  describe('POST /wallets/:walletId/swaps', () => {
    it('converts at the current rate and records the rate applied', async () => {
      const walletId = await createWallet(ctx, { cNGN: '20000' });

      const res = await post(walletId, 'swaps', {
        fromCurrency: 'cNGN',
        toCurrency: 'USDx',
        amount: '16000',
      }).expect(201);

      expect(res.body.data).toMatchObject({
        type: 'SWAP',
        senderWalletId: walletId,
        receiverWalletId: walletId,
        sourceAmount: '16000.000000',
        destinationCurrency: 'USDx',
        destinationAmount: '10.000000',
        rate: '0.000625',
        rateSource: 'LIVE',
      });
      expect(res.body.data.rateRefreshedAt).toEqual(expect.any(String));

      const balances = await getBalances(ctx, walletId);
      expect(balances.cNGN).toBe('4000.000000');
      expect(balances.USDx).toBe('10.000000');
    });

    it('truncates the destination amount to the smallest unit', async () => {
      const walletId = await createWallet(ctx, { cGHS: '100' });

      const res = await post(walletId, 'swaps', {
        fromCurrency: 'cGHS',
        toCurrency: 'cNGN',
        amount: '100',
      }).expect(201);

      // 1600 / 12 = 133.333333333 (12 significant digits) -> 13333.3333333 -> truncated
      expect(res.body.data.rate).toBe('133.333333333');
      expect(res.body.data.destinationAmount).toBe('13333.333333');
    });

    it('rejects a swap that would make the balance negative', async () => {
      const walletId = await createWallet(ctx, { cNGN: '100' });
      const before = await transactionCount();

      const res = await post(walletId, 'swaps', {
        fromCurrency: 'cNGN',
        toCurrency: 'USDx',
        amount: '100.000001',
      }).expect(422);

      expect(res.body.message).toBe('Insufficient cNGN balance');
      expect(await getBalances(ctx, walletId)).toMatchObject({
        cNGN: '100.000000',
        USDx: '0.000000',
      });
      expect(await transactionCount()).toBe(before);
    });

    it('rejects an amount too small to produce any destination units', async () => {
      const walletId = await createWallet(ctx, { cNGN: '1' });
      const res = await post(walletId, 'swaps', {
        fromCurrency: 'cNGN',
        toCurrency: 'USDx',
        amount: '0.000001',
      }).expect(400);
      expect(res.body.message).toBe('Amount is too small to convert into USDx');
    });

    it('rejects swapping a coin for itself', async () => {
      const walletId = await createWallet(ctx, { USDx: '10' });
      await post(walletId, 'swaps', {
        fromCurrency: 'USDx',
        toCurrency: 'USDx',
        amount: '1',
      }).expect(400);
    });
  });

  describe('POST /wallets/:walletId/transfers', () => {
    it('moves funds between wallets in the same currency', async () => {
      const sender = await createWallet(ctx, { cNGN: '1000' });
      const receiver = await createWallet(ctx);

      const res = await post(sender, 'transfers', {
        recipientWalletId: receiver,
        sourceCurrency: 'cNGN',
        amount: '400',
      }).expect(201);

      expect(res.body.data).toMatchObject({
        type: 'TRANSFER',
        senderWalletId: sender,
        receiverWalletId: receiver,
        sourceCurrency: 'cNGN',
        sourceAmount: '400.000000',
        destinationCurrency: 'cNGN',
        destinationAmount: '400.000000',
        rate: '1',
        rateSource: null,
      });
      expect((await getBalances(ctx, sender)).cNGN).toBe('600.000000');
      expect((await getBalances(ctx, receiver)).cNGN).toBe('400.000000');
    });

    it('converts automatically when the currencies differ', async () => {
      const sender = await createWallet(ctx, { cNGN: '5000' });
      const receiver = await createWallet(ctx);

      const res = await post(sender, 'transfers', {
        recipientWalletId: receiver,
        sourceCurrency: 'cNGN',
        destinationCurrency: 'cGHS',
        amount: '1600',
      }).expect(201);

      expect(res.body.data).toMatchObject({
        sourceAmount: '1600.000000',
        destinationCurrency: 'cGHS',
        destinationAmount: '12.000000',
        rate: '0.0075',
        rateSource: 'LIVE',
      });
      expect((await getBalances(ctx, sender)).cNGN).toBe('3400.000000');
      expect((await getBalances(ctx, receiver)).cGHS).toBe('12.000000');
    });

    it('rolls back the debit when the recipient does not exist', async () => {
      const sender = await createWallet(ctx, { USDx: '50' });
      const before = await transactionCount();

      const res = await post(sender, 'transfers', {
        recipientWalletId: '6720c0f1a2b3c4d5e6f70812',
        sourceCurrency: 'USDx',
        amount: '20',
      }).expect(404);

      expect(res.body.message).toBe('Recipient wallet not found');
      expect((await getBalances(ctx, sender)).USDx).toBe('50.000000');
      expect(await transactionCount()).toBe(before);
    });

    it('rejects a transfer exceeding the balance', async () => {
      const sender = await createWallet(ctx, { USDx: '5' });
      const receiver = await createWallet(ctx);

      await post(sender, 'transfers', {
        recipientWalletId: receiver,
        sourceCurrency: 'USDx',
        amount: '5.01',
      }).expect(422);
      expect((await getBalances(ctx, receiver)).USDx).toBe('0.000000');
    });

    it('rejects a transfer to the same wallet', async () => {
      const wallet = await createWallet(ctx, { USDx: '5' });
      await post(wallet, 'transfers', {
        recipientWalletId: wallet,
        sourceCurrency: 'USDx',
        amount: '1',
      }).expect(400);
    });
  });
});
