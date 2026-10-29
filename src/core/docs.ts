import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  type OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import type { Request, Response } from 'express';
import configuration from './configuration';
import { IDEMPOTENCY_KEY_HEADER, IDEMPOTENT_REPLAY_HEADER } from './constants';

export const DOCS_PATH = '/docs';
export const OPENAPI_JSON_PATH = '/openapi.json';

const DESCRIPTION = `
Stablecoin wallet sandbox: simulated deposits, FX swaps and cross-border transfers across **cNGN, cGHS, cXAF, USDx and EURx**.

Each **user** owns exactly **one wallet per coin**. Money always moves between wallets, and a wallet's coin decides the currency of what it sends or receives.

### Conventions
- Every response uses the envelope \`{ code, message, data?, metadata?, errors? }\`.
- **Amounts are decimal strings** (e.g. \`"1500.25"\`), never JSON numbers, so no precision is lost to floating point. Each coin has 6 decimal places.
- Money-moving endpoints require an **\`${IDEMPOTENCY_KEY_HEADER}\`** header. Replaying a key with the same payload returns the original transaction with \`200\` and \`${IDEMPOTENT_REPLAY_HEADER}: true\`; reusing it with a different payload returns \`422\`.
- FX conversions truncate to the destination coin's smallest unit and record the exact rate applied.

### Quick start
1. \`POST /api/v1/users\` twice. Each response lists the user's 5 wallets — note their ids.
2. \`POST /api/v1/wallets/{walletId}/deposits\` to fund one of the first user's wallets.
3. \`POST /api/v1/wallets/{walletId}/swaps\` into another coin, or \`/transfers\` to one of the second user's wallets (any coin — it converts automatically).
4. Read \`GET /api/v1/users/{userId}\` for balances and \`/transactions\` for history.
`;

export const buildOpenApiDocument = (app: INestApplication): OpenAPIObject => {
  const { app: meta, port } = configuration();

  const config = new DocumentBuilder()
    .setTitle(`${meta.name} API`)
    .setDescription(DESCRIPTION.trim())
    .setVersion('1.0.0')
    .addServer(`http://localhost:${port}`, 'Local')
    .addTag('Users', 'Create users (each gets one wallet per coin)')
    .addTag('Wallets', 'Single-currency wallets')
    .addTag('Money Movement', 'Deposits, swaps and transfers (idempotent)')
    .addTag('Transactions', 'Transaction history')
    .addTag('FX Rates', 'Conversion rates between supported stablecoins')
    .addTag('Health', 'Service health')
    .build();

  return SwaggerModule.createDocument(app, config, {
    autoTagControllers: false,
  });
};

/** Serves the raw OpenAPI spec and a Scalar API reference on top of it. */
export const setupApiDocs = (app: INestApplication): void => {
  const document = buildOpenApiDocument(app);

  app
    .getHttpAdapter()
    .get(OPENAPI_JSON_PATH, (_req: Request, res: Response) =>
      res.json(document),
    );

  app.use(
    DOCS_PATH,
    apiReference({
      content: document,
      theme: 'purple',
      layout: 'modern',
      defaultHttpClient: { targetKey: 'shell', clientKey: 'curl' },
      metaData: { title: `${configuration().app.name} API Reference` },
    }),
  );
};
