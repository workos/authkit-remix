/* istanbul ignore file */

type SearchParamsModifier = Record<string, string> | ((params: URLSearchParams) => void);

/**
 * Asserts that the given value is a Response object.
 * This is useful for type guards and uses Jest's expect to throw an error if the value is not a Response.
 * @param response - The value to assert is a Response object.
 */
export function assertIsResponse(response: unknown): asserts response is Response {
  expect(response).toBeInstanceOf(Response);
}

/**
 * Creates a new Request object with the given search parameters.
 * @param request - The original Request object.
 * @param modifier - The search parameters to add or modify.
 * @returns A new Request object with the modified search parameters.
 */
export function createRequestWithSearchParams(request: Request, modifier: SearchParamsModifier): Request {
  const url = new URL(request.url);

  if (typeof modifier === 'function') {
    // Allow direct manipulation of searchParams
    modifier(url.searchParams);
  } else {
    // Simple key-value setting
    Object.entries(modifier).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }

  return new Request(url, request);
}

/**
 * Creates a mock WorkOS authentication response object.
 * @param overrides - Any properties to override in the mock response.
 * @returns A mock WorkOS authentication response object.
 */
export function createAuthWithCodeResponse(overrides: Record<string, unknown> = {}) {
  return {
    accessToken: 'access123',
    refreshToken: 'refresh123',
    user: {
      id: 'user_123',
      email: 'test@example.com',
      emailVerified: true,
      profilePictureUrl: 'https://example.com/photo.jpg',
      firstName: 'Test',
      lastName: 'User',
      object: 'user' as const,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      lastSignInAt: '2024-01-01T00:00:00Z',
      externalId: null,
    },
    ...overrides,
  };
}
