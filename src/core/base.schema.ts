import { applyDecorators } from '@nestjs/common';
import { Schema, type SchemaOptions } from '@nestjs/mongoose';

export const BaseSchemaDecorator = (options?: SchemaOptions) =>
  applyDecorators(
    Schema({
      timestamps: true,
      versionKey: false,
      ...options,
    }),
  );

export abstract class BaseSchema {
  createdAt!: Date;
  updatedAt!: Date;
}
