import {
  createTestApp,
  createUser,
  idempotencyKey,
  path,
  type TestContext,
  type TestUser,
} from './utils/test-app';

describe('Transaction history', () => {
  let ctx: TestContext;
  let alice: TestUser;
  let bob: TestUser;

  const send = (walletId: string, route: string, body: object) =>
    ctx
      .api()
      .post(path(`/wallets/${walletId}/${route}`))
      .set('Idempotency-Key', idempotencyKey())
      .send(body)
      .expect(201);

  const userHistory = (
    userId: string,
    query: Record<string, string | number> = {},
  ) =>
    ctx
      .api()
      .get(path(`/users/${userId}/transactions`))
      .query(query);

  const walletHistory = (
    walletId: string,
    query: Record<string, string | number> = {},
  ) =>
    ctx
      .api()
      .get(path(`/wallets/${walletId}/transactions`))
      .query(query);

  const types = (res: { body: { data: { type: string }[] } }) =>
    res.body.data.map((t) => t.type);

  beforeAll(async () => {
    ctx = await createTestApp();
    [alice, bob] = await Promise.all([createUser(ctx), createUser(ctx)]);

    // Alice: deposit -> swap -> send to Bob's cGHS; Bob: deposit -> send to Alice.
    await send(alice.wallets.cNGN, 'deposits', { amount: '32000' });
    await send(alice.wallets.cNGN, 'swaps', {
      toCurrency: 'USDx',
      amount: '16000',
    });
    await send(alice.wallets.cNGN, 'transfers', {
      recipientWalletId: bob.wallets.cGHS,
      amount: '1600',
    });
    await send(bob.wallets.EURx, 'deposits', { amount: '10' });
    await send(bob.wallets.EURx, 'transfers', {
      recipientWalletId: alice.wallets.EURx,
      amount: '2',
    });
  });
  afterAll(() => ctx.close());

  describe('GET /users/:userId/transactions', () => {
    it('lists everything across the user’s wallets, newest first', async () => {
      const res = await userHistory(alice.id).expect(200);

      expect(types(res)).toEqual(['TRANSFER', 'TRANSFER', 'SWAP', 'DEPOSIT']);
      expect(res.body.data[0]).toMatchObject({
        senderUserId: bob.id,
        receiverUserId: alice.id,
        receiverWalletId: alice.wallets.EURx,
      });
      expect(res.body.data[1]).toMatchObject({
        senderUserId: alice.id,
        receiverUserId: bob.id,
        receiverWalletId: bob.wallets.cGHS,
      });
    });

    it('paginates with metadata', async () => {
      const page1 = await userHistory(alice.id, { limit: 3 }).expect(200);
      expect(page1.body.data).toHaveLength(3);
      expect(page1.body.metadata).toEqual({
        page: 1,
        limit: 3,
        totalDocs: 4,
        totalPages: 2,
        prevPage: null,
        nextPage: 2,
      });

      const page2 = await userHistory(alice.id, { limit: 3, page: 2 }).expect(
        200,
      );
      expect(types(page2)).toEqual(['DEPOSIT']);
    });

    it('filters by type', async () => {
      const res = await userHistory(alice.id, { type: 'TRANSFER' }).expect(200);
      expect(res.body.data).toHaveLength(2);
    });

    it('filters by currency on either side of the transaction', async () => {
      const usdx = await userHistory(alice.id, { currency: 'USDx' }).expect(
        200,
      );
      expect(types(usdx)).toEqual(['SWAP']);

      const cghs = await userHistory(bob.id, { currency: 'cGHS' }).expect(200);
      expect(cghs.body.data).toHaveLength(1);
      expect(cghs.body.data[0]).toMatchObject({
        sourceCurrency: 'cNGN',
        destinationCurrency: 'cGHS',
      });
    });

    it('filters by date range', async () => {
      const future = new Date(Date.now() + 60_000).toISOString();
      const res = await userHistory(alice.id, { startDate: future }).expect(
        200,
      );
      expect(res.body.data).toEqual([]);
    });

    it.each<Record<string, string | number>>([
      { type: 'REFUND' },
      { currency: 'BTC' },
      { limit: 101 },
      { page: 0 },
      { startDate: 'yesterday' },
    ])('rejects invalid query %j', async (query) => {
      await userHistory(alice.id, query).expect(400);
    });

    it('returns 404 for an unknown user', async () => {
      await userHistory('6720c0f1a2b3c4d5e6f70812').expect(404);
    });
  });

  describe('GET /wallets/:walletId/transactions', () => {
    it('lists only movements in or out of that wallet', async () => {
      const cngn = await walletHistory(alice.wallets.cNGN).expect(200);
      expect(types(cngn)).toEqual(['TRANSFER', 'SWAP', 'DEPOSIT']);

      const usdx = await walletHistory(alice.wallets.USDx).expect(200);
      expect(types(usdx)).toEqual(['SWAP']);

      const eurx = await walletHistory(alice.wallets.EURx).expect(200);
      expect(eurx.body.data).toHaveLength(1);
      expect(eurx.body.data[0]).toMatchObject({
        type: 'TRANSFER',
        senderUserId: bob.id,
      });
    });

    it('returns 404 for an unknown wallet', async () => {
      await walletHistory('6720c0f1a2b3c4d5e6f70812').expect(404);
    });
  });

  describe('GET /transactions/:transactionId', () => {
    it('returns a single transaction', async () => {
      const list = await userHistory(bob.id, {
        type: 'TRANSFER',
        currency: 'cGHS',
      });
      const transfer = list.body.data[0];

      const res = await ctx
        .api()
        .get(path(`/transactions/${transfer.id}`))
        .expect(200);
      expect(res.body.data).toEqual(transfer);
      expect(res.body.data).toMatchObject({
        senderUserId: alice.id,
        senderWalletId: alice.wallets.cNGN,
        receiverUserId: bob.id,
        receiverWalletId: bob.wallets.cGHS,
        sourceAmount: '1600.000000',
        destinationAmount: '12.000000',
        rate: '0.0075',
      });
    });

    it('returns 404 for an unknown transaction', async () => {
      await ctx
        .api()
        .get(path('/transactions/6720c0f1a2b3c4d5e6f70812'))
        .expect(404);
    });

    it('returns 400 for a malformed id', async () => {
      await ctx.api().get(path('/transactions/123')).expect(400);
    });
  });
});
