import { terminateSession } from './session';
import * as cookie from './cookie';
import { workos } from './workos';
import * as ironSession from 'iron-session';
import { Session, SessionData } from '@remix-run/node';

const getSession = jest.mocked(cookie.getSession);
const destroySession = jest.mocked(cookie.destroySession);
const unsealData = jest.mocked(ironSession.unsealData);
const mockedGetLogoutUrl = jest.mocked(workos.userManagement.getLogoutUrl);

jest.mock('./cookie', () => ({
  getSession: jest.fn(),
  destroySession: jest.fn().mockResolvedValue('destroyed-session-cookie'),
}));

jest.mock('./workos.js', () => ({
  workos: {
    userManagement: {
      getLogoutUrl: jest.fn(({ sessionId }) => `https://auth.workos.com/logout/${sessionId}`),
      getJwksUrl: jest.fn((clientId: string) => `https://auth.workos.com/oauth/jwks/${clientId}`),
    },
  },
}));

jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(),
  jwtVerify: jest.fn(),
  decodeJwt: jest.fn((token: string) => ({
    sid: 'test-session-id',
  })),
}));

jest.mock('iron-session', () => ({
  unsealData: jest.fn(),
}));

describe('session', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('terminateSession', () => {
    const createMockRequest = (cookie = 'test-cookie', url = 'http://example.com./some-path') =>
      new Request(url, {
        headers: new Headers({
          Cookie: cookie,
        }),
      });

    //it('should redirect to root when no jwt in session', async () => {
    //  // Setup a session without jwt
    //  const mockSession = {
    //    has: jest.fn().mockReturnValue(false),
    //    get: jest.fn(),
    //    set: jest.fn(),
    //    unset: jest.fn(),
    //    flash: jest.fn(),
    //    id: 'test-session-id',
    //    data: {},
    //  } satisfies Session;
    //
    //  getSession.mockResolvedValueOnce(mockSession);
    //
    //  // Mock unsealData to return null to simulate no session
    //  unsealData.mockResolvedValueOnce({
    //    accessToken: null,
    //    refreshToken: null,
    //    user: null,
    //    impersonator: null,
    //  });
    //
    //  // Execute
    //  const response = await terminateSession(createMockRequest());
    //
    //  // Assert response is instance of Remix Response
    //  expect(response instanceof Response).toBe(true);
    //  expect(response.status).toBe(302);
    //  expect(response.headers.get('Location')).toBe('/');
    //  expect(response.headers.get('Set-Cookie')).toBe('destroyed-session-cookie');
    //  expect(destroySession).toHaveBeenCalledWith(mockSession);
    //  expect(mockedGetLogoutUrl).not.toHaveBeenCalled();
    //});

    it('should redirect to WorkOS logout URL when valid session exists', async () => {
      // Setup a session with jwt
      const mockSession = {
        has: jest.fn().mockReturnValue(true),
        get: jest.fn().mockReturnValue('encrypted-jwt'),
        set: jest.fn(),
        unset: jest.fn(),
        flash: jest.fn(),
        id: 'test-session-id',
        data: {},
      } satisfies Session;

      getSession.mockResolvedValueOnce(mockSession);

      // Mock the unsealed session data
      const mockSessionData = {
        accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzaWQiOiJ0ZXN0LXNlc3Npb24taWQifQ.signature',
        refreshToken: 'refresh-token',
        user: { id: 'user-id' },
        impersonator: null,
      };
      unsealData.mockResolvedValueOnce(mockSessionData);

      // Execute
      const response = await terminateSession(createMockRequest());

      // Assert response is instance of Remix Response
      expect(response instanceof Response).toBe(true);
      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('https://auth.workos.com/logout/test-session-id');
      expect(response.headers.get('Set-Cookie')).toBe('destroyed-session-cookie');
      expect(destroySession).toHaveBeenCalledWith(mockSession);
      expect(mockedGetLogoutUrl).toHaveBeenCalledWith({
        sessionId: 'test-session-id',
      });
      expect(mockSession.has).toHaveBeenCalledWith('jwt');
      expect(mockSession.get).toHaveBeenCalledWith('jwt');
    });

    //it.skip('should handle errors when destroying session', async () => {
    //  const mockSession = {
    //    has: jest.fn().mockReturnValue(false),
    //    get: jest.fn(),
    //    set: jest.fn(),
    //    unset: jest.fn(),
    //    flash: jest.fn(),
    //    id: 'test-session-id',
    //    data: {},
    //  } satisfies Session;
    //
    //  getSession.mockResolvedValueOnce(mockSession);
    //
    //  // Mock session data
    //  unsealData.mockResolvedValueOnce({
    //    accessToken: null,
    //    refreshToken: null,
    //    user: null,
    //    impersonator: null,
    //  });
    //
    //  // Mock destroySession to throw an error
    //  destroySession.mockRejectedValueOnce(new Error('Failed to destroy session'));
    //
    //  // Execute and verify it still returns a valid Remix response
    //  const response = await terminateSession(createMockRequest());
    //
    //  expect(response instanceof Response).toBe(true);
    //  expect(response.status).toBe(302);
    //  expect(response.headers.get('Location')).toBe('/');
    //});
    //
    //it.skip('should handle invalid jwt data', async () => {
    //  const mockSession = {
    //    has: jest.fn().mockReturnValue(true),
    //    get: jest.fn().mockReturnValue('encrypted-jwt'),
    //    set: jest.fn(),
    //    unset: jest.fn(),
    //    flash: jest.fn(),
    //    id: 'test-session-id',
    //    data: {},
    //  } satisfies Session;
    //
    //  getSession.mockResolvedValueOnce(mockSession);
    //
    //  // Mock unsealData to throw an error
    //  unsealData.mockRejectedValueOnce(new Error('Invalid seal'));
    //
    //  // Execute
    //  const response = await terminateSession(createMockRequest());
    //
    //  // Should still return a valid Remix response
    //  expect(response instanceof Response).toBe(true);
    //  expect(response.status).toBe(302);
    //  expect(response.headers.get('Location')).toBe('/');
    //  expect(response.headers.get('Set-Cookie')).toBe('destroyed-session-cookie');
    //});
  });
});
