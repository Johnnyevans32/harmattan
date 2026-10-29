import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ParseObjectIdPipe } from '@/core/pipes/parse-object-id.pipe';
import {
  ApiDataResponse,
  ApiErrorResponse,
  ResponseService,
} from '@/core/response';
import { CreateUserDto } from './dto/user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UserService } from './user.service';

@ApiTags('Users')
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a user',
    description:
      'Creates a user with one zero-balance wallet per supported stablecoin. An email or phone number can belong to only one user.',
  })
  @ApiDataResponse(UserResponseDto, { status: HttpStatus.CREATED })
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, 'Validation failed')
  @ApiErrorResponse(HttpStatus.CONFLICT, 'A user already exists for this email')
  async create(
    @Body() dto: CreateUserDto,
    @Res() res: Response,
  ): Promise<void> {
    const user = await this.userService.create(dto);
    return ResponseService.json(
      res,
      HttpStatus.CREATED,
      'User created successfully',
      user,
    );
  }

  @Get(':userId')
  @ApiOperation({
    summary: 'Get a user with all wallet balances',
    description:
      'Returns every wallet (one per coin) plus the total equivalent in USD.',
  })
  @ApiParam({ name: 'userId', example: '6720c0f1a2b3c4d5e6f70812' })
  @ApiDataResponse(UserResponseDto)
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'User not found')
  async findOne(
    @Param('userId', ParseObjectIdPipe) userId: string,
    @Res() res: Response,
  ): Promise<void> {
    const user = await this.userService.findById(userId);
    return ResponseService.json(
      res,
      HttpStatus.OK,
      'User retrieved successfully',
      user,
    );
  }
}
