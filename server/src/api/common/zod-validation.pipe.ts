import { BadRequestException, Injectable } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * The codebase-native replacement for `class-validator`/`class-transformer`
 * pipes (design.md D5): constructed per-route with a zod schema
 * (`@Body(new ZodValidationPipe(schema))`), it runs `schema.safeParse` in
 * `transform` and throws a `BadRequestException` carrying the flattened
 * zod issues on failure, or returns the parsed (and therefore typed) value
 * on success. Zod 4 implements Standard Schema, so this is the one pipe
 * every route's body validation goes through - no `class-validator`
 * decorators anywhere in `api/`.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(result.error.flatten());
    }
    return result.data;
  }
}
