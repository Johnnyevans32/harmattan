import { toMoney } from '@/core/money';
import {
  createTestApp,
  createWallet,
  getBalances,
  idempotencyKey,
  path,
  type TestContext,
} from './utils/test-app';

describe('Concurrency', () => {
  let ctx: TestContext;

  const send = (walletId: string, route: string, body: object) =>
    ctx
      .api()
      .post(path(`/wallets/${walletId}/${route}`))
      .set('Idempotency-Key', idempotencyKey())
      .send(body);

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  it('never overdraws under parallel swaps', async () => {
    const walletId = await createWallet(ctx, { cNGN: '16000' });

    // 20 swaps of 1600 cNGN against a balance that only covers 10.
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        send(walletId, 'swaps', {
          fromCurrency: 'cNGN',
          toCurrency: 'USDx',
          amount: '1600',
        }),
      ),
    );

    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(10);
    expect(statuses.filter((s) => s === 422)).toHaveLength(10);
    expect(await getBalances(ctx, walletId)).toMatchObject({
      cNGN: '0.000000',
      USDx: '10.000000',
    });
  });

  it('never overdraws under parallel transfers to many recipients', async () => {
    const sender = await createWallet(ctx, { USDx: '100' });
    const recipients = await Promise.all(
      Array.from({ length: 6 }, () => createWallet(ctx)),
    );

    const results = await Promise.all(
      recipients.flatMap((recipient) =>
        [1, 2].map(() =>
          send(sender, 'transfers', {
            recipientWalletId: recipient,
            sourceCurrency: 'USDx',
            amount: '20',
          }),
        ),
      ),
    );

    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
    expect((await getBalances(ctx, sender)).USDx).toBe('0.000000');

    const received = await Promise.all(
      recipients.map((r) => getBalances(ctx, r)),
    );
    const total = received.reduce((sum, b) => sum.add(b.USDx), toMoney(0));
    expect(total.toFixed()).toBe('100');
  });

  it('conserves funds when two wallets send to each other simultaneously', async () => {
    const a = await createWallet(ctx, { EURx: '50' });
    const b = await createWallet(ctx, { EURx: '50' });

    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        i % 2 === 0
          ? send(a, 'transfers', {
              recipientWalletId: b,
              sourceCurrency: 'EURx',
              amount: '7',
            })
          : send(b, 'transfers', {
              recipientWalletId: a,
              sourceCurrency: 'EURx',
              amount: '3',
            }),
      ),
    ).then((results) => results.forEach((r) => expect(r.status).toBe(201)));

    const [balanceA, balanceB] = await Promise.all([
      getBalances(ctx, a),
      getBalances(ctx, b),
    ]);
    expect(balanceA.EURx).toBe('30.000000'); // 50 - 5*7 + 5*3
    expect(balanceB.EURx).toBe('70.000000');
  });
});
