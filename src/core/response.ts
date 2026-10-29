import {
  applyDecorators,
  HttpException,
  HttpStatus,
  Logger,
  type Type,
} from '@nestjs/common';
import {
  ApiExtraModels,
  ApiProperty,
  ApiPropertyOptional,
  ApiResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { Type as TransformType } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import type { Response } from 'express';

export class PaginationMetaDataDto {
  @ApiProperty({ description: 'Current page number', example: 1 })
  page!: number;

  @ApiProperty({ description: 'Number of items per page', example: 20 })
  limit!: number;

  @ApiProperty({ description: 'Total number of items', example: 42 })
  totalDocs!: number;

  @ApiProperty({
    description: 'Previous page number',
    type: Number,
    nullable: true,
    example: null,
  })
  prevPage!: number | null;

  @ApiProperty({
    description: 'Next page number',
    type: Number,
    nullable: true,
    example: 2,
  })
  nextPage!: number | null;

  @ApiProperty({ description: 'Total count of pages', example: 3 })
  totalPages!: number;
}

export class ApiResponseDto<T> {
  @ApiProperty({ description: 'HTTP status code', example: 200 })
  code!: number;

  @ApiProperty({ description: 'Human-readable message' })
  message!: string;

  @ApiPropertyOptional({ description: 'Response payload' })
  data?: T;

  @ApiPropertyOptional({ type: PaginationMetaDataDto })
  metadata?: PaginationMetaDataDto;

  @ApiPropertyOptional({
    description: 'Validation errors, when the request was rejected',
    type: [String],
  })
  errors?: string[];
}

export class PaginateDTO {
  @ApiPropertyOptional({ description: 'Page number', default: 1, minimum: 1 })
  @IsOptional()
  @TransformType(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    description: 'Items per page',
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @TransformType(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

export class ResponseService {
  private static readonly logger = new Logger(ResponseService.name);

  static json<T>(
    res: Response,
    statusOrError: unknown,
    message?: string,
    data?: T,
    metadata?: PaginationMetaDataDto,
  ): void {
    if (typeof statusOrError !== 'number') {
      return ResponseService.error(res, statusOrError);
    }

    const body: ApiResponseDto<T> = {
      code: statusOrError,
      message: message ?? HttpStatus[statusOrError] ?? 'OK',
      ...(data !== undefined && data !== null && { data }),
      ...(metadata && { metadata }),
    };

    res.status(statusOrError).json(body);
  }

  private static error(res: Response, error: unknown): void {
    if (!(error instanceof HttpException)) {
      ResponseService.logger.error(
        error instanceof Error ? error.stack : String(error),
      );
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        code: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
      } satisfies ApiResponseDto<never>);
      return;
    }

    const status = error.getStatus();
    const payload = error.getResponse();
    const details =
      typeof payload === 'object' && payload !== null && 'message' in payload
        ? payload.message
        : undefined;
    const errors = Array.isArray(details) ? details.map(String) : undefined;

    res.status(status).json({
      code: status,
      message: errors ? 'Validation failed' : error.message,
      ...(errors && { errors }),
    } satisfies ApiResponseDto<never>);
  }
}

interface ApiDataResponseOptions {
  status?: number;
  description?: string;
  isArray?: boolean;
  paginated?: boolean;
}

/**
 * Documents the `{ code, message, data, metadata }` envelope with a concrete
 * `data` schema (generics are erased at runtime, so this is done explicitly).
 */
export const ApiDataResponse = <TModel extends Type<unknown>>(
  model: TModel,
  {
    status = HttpStatus.OK,
    description,
    isArray = false,
    paginated = false,
  }: ApiDataResponseOptions = {},
) => {
  const item = { $ref: getSchemaPath(model) };

  return applyDecorators(
    ApiExtraModels(ApiResponseDto, PaginationMetaDataDto, model),
    ApiResponse({
      status,
      description,
      schema: {
        allOf: [
          { $ref: getSchemaPath(ApiResponseDto) },
          {
            properties: {
              code: { type: 'number', example: status },
              data:
                isArray || paginated ? { type: 'array', items: item } : item,
              ...(paginated && {
                metadata: { $ref: getSchemaPath(PaginationMetaDataDto) },
              }),
            },
          },
        ],
      },
    }),
  );
};

export const ApiErrorResponse = (status: number, description: string) =>
  applyDecorators(
    ApiExtraModels(ApiResponseDto),
    ApiResponse({
      status,
      description,
      schema: {
        allOf: [
          { $ref: getSchemaPath(ApiResponseDto) },
          {
            properties: {
              code: { type: 'number', example: status },
              message: { type: 'string', example: description },
            },
          },
        ],
      },
    }),
  );
