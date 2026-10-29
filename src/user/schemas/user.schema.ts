import { Prop, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { BaseSchema, BaseSchemaDecorator } from '@/core/base.schema';

export type UserDocument = HydratedDocument<User>;

@BaseSchemaDecorator()
export class User extends BaseSchema {
  @Prop({ type: String, lowercase: true, trim: true })
  email?: string;

  /** E.164, e.g. +2348012345678 */
  @Prop({ type: String, trim: true })
  phone?: string;
}

export const UserSchema = SchemaFactory.createForClass(User);

// A contact can own at most one user. Partial (not sparse) indexes so users
// created with only one of the two identifiers never collide.
UserSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' } } },
);
UserSchema.index(
  { phone: 1 },
  { unique: true, partialFilterExpression: { phone: { $type: 'string' } } },
);
