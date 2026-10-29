import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsPhoneNumber, ValidateIf } from 'class-validator';

const CONTACT_REQUIRED = 'Provide an email address or a phone number';

export class CreateUserDto {
  @ApiPropertyOptional({
    description: 'Owner email. At least one of email or phone is required.',
    example: 'ada@example.com',
  })
  @ValidateIf(
    (dto: CreateUserDto) => dto.email !== undefined || dto.phone === undefined,
  )
  @IsEmail({}, { message: `email must be a valid email. ${CONTACT_REQUIRED}` })
  email?: string;

  @ApiPropertyOptional({
    description: 'Owner phone number in international format.',
    example: '+2348012345678',
  })
  @ValidateIf(
    (dto: CreateUserDto) => dto.phone !== undefined || dto.email === undefined,
  )
  @IsPhoneNumber(undefined, {
    message: `phone must be a valid international number, e.g. +2348012345678. ${CONTACT_REQUIRED}`,
  })
  phone?: string;
}
