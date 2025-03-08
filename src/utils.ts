import { DataWithResponseInit } from './interfaces.js';

/**
 * Returns a function that can only be called once.
 * Subsequent calls will return the result of the first call.
 * This is useful for lazy initialization.
 * @param fn - The function to be called once.
 * @returns A function that can only be called once.
 */
export function lazy<T>(fn: () => T): () => T {
  let called = false;
  let result: T;
  return () => {
    if (!called) {
      result = fn();
      called = true;
    }
    return result;
  };
}

/**
 * Returns true if the response is a redirect.
 * @param res - The response to check.
 * @returns True if the response is a redirect.
 */
export function isRedirect(res: Response) {
  return res.status >= 300 && res.status < 400;
}

/**
 * Returns true if the response is a response.
 * @param response - The response to check.
 * @returns True if the response is a response.
 */
export function isResponse(response: unknown): response is Response {
  return response instanceof Response;
}

/**
 * Returns true if the data is a DataWithResponseInit object.
 */
export function isDataWithResponseInit(data: unknown): data is DataWithResponseInit<unknown> {
  return (
    typeof data === 'object' &&
    data != null &&
    'type' in data &&
    'data' in data &&
    'init' in data &&
    data.type === 'DataWithResponseInit'
  );
}
