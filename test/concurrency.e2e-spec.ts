import { toMoney } from '@/core/money';
import {
  createTestApp,
  createUser,
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
    const user = await createUser(ctx, { cNGN: '16000' });

    // 20 swaps of 1600 cNGN against a balance that only covers 10.
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        send(user.wallets.cNGN, 'swaps', {
          toCurrency: 'USDx',
          amount: '1600',
        }),
      ),
    );

    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(10);
    expect(statuses.filter((s) => s === 422)).toHaveLength(10);
    expect(await getBalances(ctx, user.id)).toMatchObject({
      cNGN: '0.000000',
      USDx: '10.000000',
    });
  });

  it('never overdraws under parallel transfers to many recipients', async () => {
    const sender = await createUser(ctx, { USDx: '100' });
    const recipients = await Promise.all(
      Array.from({ length: 6 }, () => createUser(ctx)),
    );

    const results = await Promise.all(
      recipients.flatMap((recipient) =>
        [1, 2].map(() =>
          send(sender.wallets.USDx, 'transfers', {
            recipientWalletId: recipient.wallets.USDx,
            amount: '20',
          }),
        ),
      ),
    );

    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
    expect((await getBalances(ctx, sender.id)).USDx).toBe('0.000000');

    const received = await Promise.all(
      recipients.map((r) => getBalances(ctx, r.id)),
    );
    const total = received.reduce((sum, b) => sum.add(b.USDx), toMoney(0));
    expect(total.toFixed()).toBe('100');
  });

  it('conserves funds when two users send to each other simultaneously', async () => {
    const a = await createUser(ctx, { EURx: '50' });
    const b = await createUser(ctx, { EURx: '50' });

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        i % 2 === 0
          ? send(a.wallets.EURx, 'transfers', {
              recipientWalletId: b.wallets.EURx,
              amount: '7',
            })
          : send(b.wallets.EURx, 'transfers', {
              recipientWalletId: a.wallets.EURx,
              amount: '3',
            }),
      ),
    );
    results.forEach((r) => expect(r.status).toBe(201));

    const [balanceA, balanceB] = await Promise.all([
      getBalances(ctx, a.id),
      getBalances(ctx, b.id),
    ]);
    expect(balanceA.EURx).toBe('30.000000'); // 50 - 5*7 + 5*3
    expect(balanceB.EURx).toBe('70.000000');
  });

  it("doesn't contend across a user's different wallets", async () => {
    const user = await createUser(ctx, { USDx: '50', EURx: '40' });
    const other = await createUser(ctx);

    const results = await Promise.all([
      ...Array.from({ length: 5 }, () =>
        send(user.wallets.USDx, 'swaps', { toCurrency: 'cGHS', amount: '10' }),
      ),
      ...Array.from({ length: 5 }, () =>
        send(user.wallets.EURx, 'transfers', {
          recipientWalletId: other.wallets.EURx,
          amount: '8',
        }),
      ),
    ]);
    results.forEach((r) => expect(r.status).toBe(201));

    expect(await getBalances(ctx, user.id)).toMatchObject({
      USDx: '0.000000',
      EURx: '0.000000',
      cGHS: '600.000000',
    });
    expect((await getBalances(ctx, other.id)).EURx).toBe('40.000000');
  });
});
