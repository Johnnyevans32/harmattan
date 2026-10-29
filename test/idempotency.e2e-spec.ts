import {
  createTestApp,
  createUser,
  getBalances,
  idempotencyKey,
  path,
  type TestContext,
} from './utils/test-app';

describe('Idempotency', () => {
  let ctx: TestContext;

  const send = (walletId: string, route: string, key: string, body: object) =>
    ctx
      .api()
      .post(path(`/wallets/${walletId}/${route}`))
      .set('Idempotency-Key', key)
      .send(body);

  const countByKey = (key: string) =>
    ctx.connection
      .collection('transactions')
      .countDocuments({ idempotencyKey: key });

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  it('replays a retried swap instead of processing it twice', async () => {
    const user = await createUser(ctx, { cNGN: '10000' });
    const key = idempotencyKey();
    const body = { toCurrency: 'USDx', amount: '1600' };

    const first = await send(user.wallets.cNGN, 'swaps', key, body).expect(201);
    const retry = await send(user.wallets.cNGN, 'swaps', key, body).expect(200);

    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(retry.body.data).toEqual(first.body.data);
    expect(await getBalances(ctx, user.id)).toMatchObject({
      cNGN: '8400.000000',
      USDx: '1.000000',
    });
    expect(await countByKey(key)).toBe(1);
  });

  it('treats numerically equal amounts as the same request', async () => {
    const user = await createUser(ctx);
    const key = idempotencyKey();

    await send(user.wallets.USDx, 'deposits', key, { amount: '100' }).expect(
      201,
    );
    await send(user.wallets.USDx, 'deposits', key, { amount: '100.00' }).expect(
      200,
    );

    expect((await getBalances(ctx, user.id)).USDx).toBe('100.000000');
  });

  it('rejects reuse of a key with a different payload', async () => {
    const user = await createUser(ctx);
    const key = idempotencyKey();

    await send(user.wallets.USDx, 'deposits', key, { amount: '10' }).expect(
      201,
    );
    const res = await send(user.wallets.USDx, 'deposits', key, {
      amount: '11',
    }).expect(422);

    expect(res.body.message).toBe(
      'Idempotency-Key was already used for a different request',
    );
    expect((await getBalances(ctx, user.id)).USDx).toBe('10.000000');
  });

  it('rejects reuse of a key across different operations', async () => {
    const user = await createUser(ctx, { USDx: '10' });
    const key = idempotencyKey();

    await send(user.wallets.USDx, 'deposits', key, { amount: '1' }).expect(201);
    await send(user.wallets.USDx, 'swaps', key, {
      toCurrency: 'EURx',
      amount: '1',
    }).expect(422);
  });

  it('scopes keys per wallet', async () => {
    const user = await createUser(ctx);
    const key = idempotencyKey();

    await send(user.wallets.cXAF, 'deposits', key, { amount: '5' }).expect(201);
    await send(user.wallets.cGHS, 'deposits', key, { amount: '5' }).expect(201);
  });

  it('processes concurrent duplicates exactly once', async () => {
    const sender = await createUser(ctx, { USDx: '100' });
    const receiver = await createUser(ctx);
    const key = idempotencyKey();
    const body = { recipientWalletId: receiver.wallets.USDx, amount: '30' };

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        send(sender.wallets.USDx, 'transfers', key, body),
      ),
    );

    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 200)).toHaveLength(9);
    expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1);
    expect((await getBalances(ctx, sender.id)).USDx).toBe('70.000000');
    expect((await getBalances(ctx, receiver.id)).USDx).toBe('30.000000');
    expect(await countByKey(key)).toBe(1);
  });

  it('does not burn the key when the request fails', async () => {
    const user = await createUser(ctx);
    const key = idempotencyKey();
    const body = { toCurrency: 'EURx', amount: '10' };

    await send(user.wallets.USDx, 'swaps', key, body).expect(422);
    await send(user.wallets.USDx, 'deposits', idempotencyKey(), {
      amount: '10',
    }).expect(201);
    await send(user.wallets.USDx, 'swaps', key, body).expect(201);

    expect(await getBalances(ctx, user.id)).toMatchObject({
      USDx: '0.000000',
      EURx: '8.000000',
    });
  });

  it('rejects malformed keys', async () => {
    const user = await createUser(ctx);
    await send(user.wallets.USDx, 'deposits', 'short', { amount: '1' }).expect(
      400,
    );
    await send(user.wallets.USDx, 'deposits', 'has spaces in it', {
      amount: '1',
    }).expect(400);
  });
});
