import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { ResponseService } from '@/core/response';

/**
 * Routes every error — including those raised before a handler runs
 * (validation, guards, unknown routes) — through the standard envelope.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    ResponseService.json(
      host.switchToHttp().getResponse<Response>(),
      exception,
    );
  }
}
