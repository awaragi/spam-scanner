import { z } from 'zod';
import { renderEnvFile } from '../../../src/lib/utils/env-file.util.js';

describe('env-file-util', () => {
  describe('renderEnvFile', () => {
    it('renders a group header followed by each field as KEY=default', () => {
      const groups = [
        {
          title: 'Example Group',
          schema: z.object({
            FOO: z.string().default('bar'),
            BAZ: z.number().default(5),
          }),
        },
      ];

      expect(renderEnvFile(groups)).toBe('# Example Group\nFOO=bar\nBAZ=5\n');
    });

    it('emits an empty value for a field with no default', () => {
      const groups = [
        {
          title: 'Example Group',
          schema: z.object({ FOO: z.string().optional() }),
        },
      ];

      expect(renderEnvFile(groups)).toBe('# Example Group\nFOO=\n');
    });

    it('renders a single-line describe() as one leading comment line', () => {
      const groups = [
        {
          title: 'Example Group',
          schema: z.object({
            FOO: z.string().default('bar').describe('FOO does a thing.'),
          }),
        },
      ];

      expect(renderEnvFile(groups)).toBe(
        '# Example Group\n# FOO does a thing.\nFOO=bar\n'
      );
    });

    it('renders a multi-line describe() as one comment line per newline', () => {
      const groups = [
        {
          title: 'Example Group',
          schema: z.object({
            FOO: z
              .string()
              .default('bar')
              .describe('Line one.\nLine two.\n\nLine four.'),
          }),
        },
      ];

      expect(renderEnvFile(groups)).toBe(
        '# Example Group\n# Line one.\n# Line two.\n#\n# Line four.\nFOO=bar\n'
      );
    });

    it('separates groups with exactly one blank line and no blank line between fields', () => {
      const groups = [
        {
          title: 'Group One',
          schema: z.object({ FOO: z.string().default('a') }),
        },
        {
          title: 'Group Two',
          schema: z.object({
            BAR: z.string().default('b'),
            BAZ: z.string().default('c'),
          }),
        },
      ];

      expect(renderEnvFile(groups)).toBe(
        '# Group One\nFOO=a\n\n# Group Two\nBAR=b\nBAZ=c\n'
      );
    });

    it('renders a docsOnly group identically to any other group (title/schema only matter)', () => {
      const groups = [
        {
          title: 'Docs Only Group',
          docsOnly: true,
          schema: z.object({ FOO: z.string().default('a') }),
        },
      ];

      expect(renderEnvFile(groups)).toBe('# Docs Only Group\nFOO=a\n');
    });
  });
});
