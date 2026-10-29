import { NestFactory } from '@nestjs/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { buildOpenApiDocument } from '@/core/docs';

/**
 * Writes the OpenAPI spec to docs/openapi.json without a database:
 * preview mode builds the route graph but never instantiates providers.
 */
async function generate() {
  const app = configureApp(
    await NestFactory.create(AppModule, { preview: true, logger: false }),
  );
  const output = resolve(__dirname, '../docs/openapi.json');

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(
    output,
    `${JSON.stringify(buildOpenApiDocument(app), null, 2)}\n`,
  );
  await app.close();

  console.log(`OpenAPI spec written to ${output}`);
}

void generate();
