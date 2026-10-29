import { Controller, Get, HttpStatus, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  ApiDataResponse,
  ApiErrorResponse,
  ResponseService,
} from '@/core/response';
import { FxQuoteQueryDto } from './dto/fx.dto';
import { FxQuoteResponseDto, FxRateResponseDto } from './dto/fx-response.dto';
import { FxService } from './fx.service';

@ApiTags('FX Rates')
@Controller('fx')
export class FxController {
  constructor(private readonly fxService: FxService) {}

  @Get('rates')
  @ApiOperation({
    summary: 'List conversion rates',
    description:
      'Current rate for every ordered pair of supported stablecoins, with its source and when it was last refreshed.',
  })
  @ApiDataResponse(FxRateResponseDto, { isArray: true })
  getRates(@Res() res: Response): void {
    return ResponseService.json(
      res,
      HttpStatus.OK,
      'FX rates retrieved successfully',
      this.fxService.getAllRates(),
    );
  }

  @Get('quote')
  @ApiOperation({
    summary: 'Preview a conversion',
    description:
      'Shows what an amount converts to at the current rate. Indicative only; nothing is reserved.',
  })
  @ApiDataResponse(FxQuoteResponseDto)
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, 'Invalid currencies or amount')
  getQuote(@Query() query: FxQuoteQueryDto, @Res() res: Response): void {
    return ResponseService.json(
      res,
      HttpStatus.OK,
      'FX quote generated successfully',
      this.fxService.quote(query.from, query.to, query.amount),
    );
  }
}
