import { describe, expect, it } from 'vitest';
import { parseAddressList } from './sender-list.util';

describe('parseAddressList', () => {
  it('parses one address per line', () => {
    expect(parseAddressList('a@b.com\nc@d.com\n')).toEqual(['a@b.com', 'c@d.com']);
  });

  it('parses JSON array', () => {
    expect(parseAddressList('["x@y.z", ""]')).toEqual(['x@y.z']);
  });

  it('returns empty for blank input', () => {
    expect(parseAddressList('  \n  ')).toEqual([]);
  });
});
