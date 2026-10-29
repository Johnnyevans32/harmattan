import {
  BadRequestException,
  HttpStatus,
  NotFoundException,
  UnprocessableEntityException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ResponseService } from './response';

const mockResponse = () => {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as Response & typeof res;
};

describe('ResponseService', () => {
  it('wraps successful payloads in the envelope', () => {
    const res = mockResponse();
    ResponseService.json(res, HttpStatus.CREATED, 'Created', { id: '1' });

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      code: 201,
      message: 'Created',
      data: { id: '1' },
    });
  });

  it('includes pagination metadata when given', () => {
    const res = mockResponse();
    const metadata = {
      page: 1,
      limit: 20,
      totalDocs: 0,
      totalPages: 0,
      prevPage: null,
      nextPage: null,
    };
    ResponseService.json(res, HttpStatus.OK, 'OK', [], metadata);

    expect(res.json).toHaveBeenCalledWith({
      code: 200,
      message: 'OK',
      data: [],
      metadata,
    });
  });

  it('maps HTTP exceptions to their status and message', () => {
    const res = mockResponse();
    ResponseService.json(
      res,
      new UnprocessableEntityException('Insufficient cNGN balance'),
    );

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({
      code: 422,
      message: 'Insufficient cNGN balance',
    });
  });

  it('exposes validation errors as a list', () => {
    const res = mockResponse();
    ResponseService.json(
      res,
      new BadRequestException(['amount must be a decimal string']),
    );

    expect(res.json).toHaveBeenCalledWith({
      code: 400,
      message: 'Validation failed',
      errors: ['amount must be a decimal string'],
    });
  });

  it('keeps plain HTTP exceptions as a single message', () => {
    const res = mockResponse();
    ResponseService.json(res, new NotFoundException('Wallet not found'));

    expect(res.json).toHaveBeenCalledWith({
      code: 404,
      message: 'Wallet not found',
    });
  });

  it('hides unexpected errors behind a 500', () => {
    const res = mockResponse();
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    ResponseService.json(res, new Error('connection string leaked'));

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      code: 500,
      message: 'Internal server error',
    });
    log.mockRestore();
  });
});
