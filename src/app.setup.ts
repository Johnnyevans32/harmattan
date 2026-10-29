import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { HttpExceptionFilter } from './core/filters/http-exception.filter';

export const API_PREFIX = 'api/v1';

/** Shared by `main.ts` and the e2e suite so tests exercise the real pipeline. */
export const configureApp = (app: INestApplication): INestApplication => {
  app.setGlobalPrefix(API_PREFIX);
  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();
  return app;
};
