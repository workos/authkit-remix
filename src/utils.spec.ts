import { isDataWithResponseInit, isRedirect, isResponse, lazy } from './utils.js';

describe('utils', () => {
  describe('lazy', () => {
    it('should call the function only once', () => {
      const fn = jest.fn(() => 'test');
      const lazyFn = lazy(fn);

      expect(fn).not.toHaveBeenCalled();

      expect(lazyFn()).toBe('test');
      expect(fn).toHaveBeenCalledTimes(1);

      expect(lazyFn()).toBe('test');
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('isRedirect', () => {
    it('should return true for a redirect response', () => {
      const res = new Response(null, { status: 302 });

      expect(isRedirect(res)).toBe(true);
    });

    it('should return false for a non-redirect response', () => {
      const res = new Response(null, { status: 200 });

      expect(isRedirect(res)).toBe(false);
    });
  });

  describe('isResponse', () => {
    it('should return true for a Response object', () => {
      const res = new Response();

      expect(isResponse(res)).toBe(true);
    });

    it('should return false for a non-Response object', () => {
      expect(isResponse({})).toBe(false);
    });
  });

  describe('isDataWithResponseInit', () => {
    it('should return true for a DataWithResponseInit object', () => {
      const data = {
        type: 'DataWithResponseInit',
        data: {},
        init: {},
      };

      expect(isDataWithResponseInit(data)).toBe(true);
    });

    it('should return false for a non-DataWithResponseInit object', () => {
      expect(isDataWithResponseInit({})).toBe(false);
    });
  });
});
