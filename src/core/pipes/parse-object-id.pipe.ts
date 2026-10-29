import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

@Injectable()
export class ParseObjectIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!OBJECT_ID_PATTERN.test(value)) {
      throw new BadRequestException(`"${value}" is not a valid id`);
    }
    return value;
  }
}
