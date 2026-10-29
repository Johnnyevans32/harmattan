import type { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { AppModule } from '@/app.module';
import { API_PREFIX, configureApp } from '@/app.setup';
import { FX_RATE_PROVIDER } from '@/core/constants';
import { StubFxProvider } from './stub-fx-provider';

export interface TestContext {
  app: INestApplication;
  connection: Connection;
  fxProvider: StubFxProvider;
  api: () => ReturnType<typeof request>;
  close: () => Promise<void>;
}

/**
 * Boots the real application against a single-node in-memory replica set,
 * so multi-document transactions behave exactly as in production.
 */
export const createTestApp = async (
  fxProvider = new StubFxProvider(),
): Promise<TestContext> => {
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  process.env.DB_URL = replSet.getUri('harmattan-test');
  process.env.FX_REFRESH_INTERVAL_MS = '0';

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(FX_RATE_PROVIDER)
    .useValue(fxProvider)
    .compile();

  const app = configureApp(moduleRef.createNestApplication({ logger: false }));
  // Listen once so supertest doesn't re-bind the server on every request.
  await app.listen(0);

  // Unique indexes are what make duplicates impossible; ensure they exist
  // before the first request rather than racing Mongoose's autoIndex.
  const connection = app.get<Connection>(getConnectionToken());
  await Promise.all(
    Object.values(connection.models).map((model) => model.init()),
  );

  return {
    app,
    connection,
    fxProvider,
    api: () => request(app.getHttpServer()),
    close: async () => {
      await app.close();
      await replSet.stop();
    },
  };
};

export const path = (route: string) => `/${API_PREFIX}${route}`;

export const idempotencyKey = () => randomUUID();

let counter = 0;
export const uniqueEmail = () => `user${Date.now()}${counter++}@example.com`;

/** Creates a wallet and optionally funds it. Returns the wallet id. */
export const createWallet = async (
  ctx: TestContext,
  deposits: Record<string, string> = {},
): Promise<string> => {
  const res = await ctx
    .api()
    .post(path('/wallets'))
    .send({ email: uniqueEmail() })
    .expect(201);
  const walletId = res.body.data.id as string;

  for (const [currency, amount] of Object.entries(deposits)) {
    await ctx
      .api()
      .post(path(`/wallets/${walletId}/deposits`))
      .set('Idempotency-Key', idempotencyKey())
      .send({ currency, amount })
      .expect(201);
  }
  return walletId;
};

export const getBalances = async (
  ctx: TestContext,
  walletId: string,
): Promise<Record<string, string>> => {
  const res = await ctx
    .api()
    .get(path(`/wallets/${walletId}`))
    .expect(200);
  return Object.fromEntries(
    (res.body.data.balances as { currency: string; amount: string }[]).map(
      (b) => [b.currency, b.amount],
    ),
  );
};
