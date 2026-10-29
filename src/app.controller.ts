import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ConnectionStates, type Connection } from 'mongoose';
import { ResponseService } from './core/response';

@ApiTags('Health')
@Controller('health')
export class AppController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Get()
  @ApiOperation({ summary: 'Liveness and database connectivity' })
  health(@Res() res: Response): void {
    const up = this.connection.readyState === ConnectionStates.connected;
    return ResponseService.json(
      res,
      up ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE,
      up ? 'Service is healthy' : 'Database unavailable',
      { status: up ? 'ok' : 'degraded', database: up ? 'up' : 'down' },
    );
  }
}
