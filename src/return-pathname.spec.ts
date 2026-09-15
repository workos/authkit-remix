import { sanitizeReturnPathname } from './return-pathname.js';

describe('sanitizeReturnPathname', () => {
  describe('accepts', () => {
    it.each(['/', '/foo', '/foo/bar', '/foo?bar=1', '/foo?a=1&b=2', '/foo#baz', '/foo?bar=1#baz', '/a-b_c.d~e'])(
      '%s',
      (input) => {
        expect(sanitizeReturnPathname(input)).toBe(input);
      },
    );
  });

  describe('rejects', () => {
    it.each([
      ['non-leading-slash', 'foo'],
      ['empty', ''],
      ['protocol-relative //evil.com', '//evil.com'],
      ['protocol-relative with path', '//evil.com/foo'],
      ['absolute http', 'http://evil.com'],
      ['absolute https', 'https://evil.com/path'],
      ['backslash prefix', '/\\evil.com'],
      ['CR injection', '/foo\rbar'],
      ['LF injection', '/foo\nbar'],
      ['CRLF Set-Cookie smuggle', '/foo\r\nSet-Cookie: bad'],
      ['dot-segment traversal', '/app/../admin'],
      ['dot-segment same-dir', '/app/./x'],
      ['URL-encoded absolute', '/%2F%2Fevil.com'],
      ['URL-encoded protocol', '//%65vil.com'],
      ['URL-encoded backslash', '/%5Cevil.com'],
      ['malformed percent encoding', '/%ZZ'],
    ])('%s → /', (_label, input) => {
      expect(sanitizeReturnPathname(input)).toBe('/');
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['number', 42],
      ['object', { pathname: '/foo' }],
      ['array', ['/foo']],
      ['boolean', true],
    ])('non-string %s → /', (_label, input) => {
      expect(sanitizeReturnPathname(input)).toBe('/');
    });

    it('oversized string (>2048 chars) → /', () => {
      expect(sanitizeReturnPathname('/' + 'a'.repeat(2048))).toBe('/');
    });
  });
});
