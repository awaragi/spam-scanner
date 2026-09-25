import { describe, test, expect } from 'vitest';
import { z } from 'zod';
import { BadRequestException } from '@nestjs/common';
import { ZodValidationPipe } from './zod-validation.pipe.js';

describe('ZodValidationPipe', () => {
  const schema = z.object({ password: z.string().min(1) });

  test('returns the parsed value when it satisfies the schema', () => {
    const pipe = new ZodValidationPipe(schema);

    expect(pipe.transform({ password: 'hunter2' })).toEqual({
      password: 'hunter2',
    });
  });

  test('throws BadRequestException with the flattened issues when validation fails', () => {
    const pipe = new ZodValidationPipe(schema);

    expect(() => pipe.transform({ password: '' })).toThrow(
      BadRequestException
    );
    expect(() => pipe.transform({})).toThrow(BadRequestException);
  });
});
