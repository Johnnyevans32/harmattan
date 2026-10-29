import {
  createTestApp,
  createWallet,
  idempotencyKey,
  path,
  type TestContext,
} from './utils/test-app';

describe('Transaction history', () => {
  let ctx: TestContext;
  let alice: string;
  let bob: string;

  const send = (walletId: string, route: string, body: object) =>
    ctx
      .api()
      .post(path(`/wallets/${walletId}/${route}`))
      .set('Idempotency-Key', idempotencyKey())
      .send(body)
      .expect(201);

  const history = (
    walletId: string,
    query: Record<string, string | number> = {},
  ) =>
    ctx
      .api()
      .get(path(`/wallets/${walletId}/transactions`))
      .query(query);

  beforeAll(async () => {
    ctx = await createTestApp();
    [alice, bob] = await Promise.all([createWallet(ctx), createWallet(ctx)]);

    // Alice: deposit -> swap -> send to Bob; Bob: deposit -> send to Alice.
    await send(alice, 'deposits', { currency: 'cNGN', amount: '32000' });
    await send(alice, 'swaps', {
      fromCurrency: 'cNGN',
      toCurrency: 'USDx',
      amount: '16000',
    });
    await send(alice, 'transfers', {
      recipientWalletId: bob,
      sourceCurrency: 'cNGN',
      destinationCurrency: 'cGHS',
      amount: '1600',
    });
    await send(bob, 'deposits', { currency: 'EURx', amount: '10' });
    await send(bob, 'transfers', {
      recipientWalletId: alice,
      sourceCurrency: 'EURx',
      amount: '2',
    });
  });
  afterAll(() => ctx.close());

  it('lists deposits, swaps, and transfers sent and received, newest first', async () => {
    const res = await history(alice).expect(200);

    expect(res.body.data.map((t: { type: string }) => t.type)).toEqual([
      'TRANSFER', // received from Bob
      'TRANSFER', // sent to Bob
      'SWAP',
      'DEPOSIT',
    ]);
    expect(res.body.data[0]).toMatchObject({
      senderWalletId: bob,
      receiverWalletId: alice,
    });
    expect(res.body.data[1]).toMatchObject({
      senderWalletId: alice,
      receiverWalletId: bob,
    });
  });

  it('paginates with metadata', async () => {
    const page1 = await history(alice, { limit: 3 }).expect(200);
    expect(page1.body.data).toHaveLength(3);
    expect(page1.body.metadata).toEqual({
      page: 1,
      limit: 3,
      totalDocs: 4,
      totalPages: 2,
      prevPage: null,
      nextPage: 2,
    });

    const page2 = await history(alice, { limit: 3, page: 2 }).expect(200);
    expect(page2.body.data).toHaveLength(1);
    expect(page2.body.data[0].type).toBe('DEPOSIT');
  });

  it('filters by type', async () => {
    const res = await history(alice, { type: 'TRANSFER' }).expect(200);
    expect(res.body.data).toHaveLength(2);
  });

  it('filters by currency on either side of the transaction', async () => {
    const usdx = await history(alice, { currency: 'USDx' }).expect(200);
    expect(usdx.body.data.map((t: { type: string }) => t.type)).toEqual([
      'SWAP',
    ]);

    const cghs = await history(bob, { currency: 'cGHS' }).expect(200);
    expect(cghs.body.data).toHaveLength(1);
    expect(cghs.body.data[0]).toMatchObject({
      sourceCurrency: 'cNGN',
      destinationCurrency: 'cGHS',
    });
  });

  it('filters by date range', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const res = await history(alice, { startDate: future }).expect(200);
    expect(res.body.data).toEqual([]);
  });

  it.each<Record<string, string | number>>([
    { type: 'REFUND' },
    { currency: 'BTC' },
    { limit: 101 },
    { page: 0 },
    { startDate: 'yesterday' },
  ])('rejects invalid query %j', async (query) => {
    await history(alice, query).expect(400);
  });

  describe('GET /transactions/:transactionId', () => {
    it('returns a single transaction', async () => {
      const list = await history(bob, { type: 'TRANSFER', currency: 'cGHS' });
      const transfer = list.body.data[0];

      const res = await ctx
        .api()
        .get(path(`/transactions/${transfer.id}`))
        .expect(200);
      expect(res.body.data).toEqual(transfer);
      expect(res.body.data).toMatchObject({
        senderWalletId: alice,
        receiverWalletId: bob,
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
