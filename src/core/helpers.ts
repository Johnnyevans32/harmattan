import { mongo } from 'mongoose';

const DUPLICATE_KEY = 11000;

export const isDuplicateKeyError = (
  error: unknown,
): error is mongo.MongoServerError & {
  keyPattern?: Record<string, unknown>;
} => error instanceof mongo.MongoServerError && error.code === DUPLICATE_KEY;
