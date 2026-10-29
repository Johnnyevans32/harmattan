import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import configuration from './core/configuration';
import { DOCS_PATH, setupApiDocs } from './core/docs';

async function bootstrap() {
  const app = configureApp(await NestFactory.create(AppModule));
  setupApiDocs(app);

  await app.listen(configuration().port);

  const url = (await app.getUrl()).replace('[::1]', 'localhost');
  const logger = new Logger('Bootstrap');
  logger.log(`API running on ${url}/api/v1`);
  logger.log(`API reference (Scalar) at ${url}${DOCS_PATH}`);
}

void bootstrap();
