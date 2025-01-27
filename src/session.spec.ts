import { Session as RemixSession } from '@remix-run/node';
import * as ironSession from 'iron-session';
import * as cookie from './cookie';
import { WORKOS_COOKIE_PASSWORD } from './env-variables';
import { Session } from './interfaces.js';
import { encryptSession, terminateSession } from './session';
import { workos } from './workos';

const getSession = jest.mocked(cookie.getSession);
const destroySession = jest.mocked(cookie.destroySession);
const unsealData = jest.mocked(ironSession.unsealData);
const sealData = jest.mocked(ironSession.sealData);
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
  decodeJwt: jest.fn((_token: string) => ({
    sid: 'test-session-id',
  })),
}));

jest.mock('iron-session', () => ({
  unsealData: jest.fn(),
  sealData: jest.fn(),
}));

describe('session', () => {
  const createMockSession = (overrides?: Record<string, any>): RemixSession =>
    ({
      has: jest.fn(),
      get: jest.fn(),
      set: jest.fn(),
      unset: jest.fn(),
      flash: jest.fn(),
      id: 'test-session-id',
      data: {},
      ...overrides,
    }) satisfies RemixSession;

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

    // TODO: add this test back in when fixing session being null issue
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
      const mockSession = createMockSession({
        has: jest.fn().mockReturnValue(true),
        get: jest.fn().mockReturnValue('encrypted-jwt'),
      });

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

    describe('encryptSession', () => {
      beforeEach(() => {
        jest.clearAllMocks();
      });

      it('should encrypt session data with correct parameters', async () => {
        const mockSession = {
          accessToken: 'test-access-token',
          refreshToken: 'test-refresh-token',
          user: {
            object: 'user',
            id: 'test-user',
            email: 'test@example.com',
            emailVerified: true,
            profilePictureUrl: 'https://example.com/avatar.jpg',
            firstName: 'Test',
            lastName: 'User',
            createdAt: '2021-01-01T00:00:00Z',
            updatedAt: '2021-01-01T00:00:00Z',
          },
          impersonator: undefined,
          headers: {},
        } satisfies Session;

        sealData.mockResolvedValueOnce('encrypted-data');

        const result = await encryptSession(mockSession);

        expect(result).toBe('encrypted-data');
        expect(sealData).toHaveBeenCalledWith(mockSession, {
          password: WORKOS_COOKIE_PASSWORD,
          ttl: 0,
        });
        expect(sealData).toHaveBeenCalledTimes(1);
      });
    });

    describe('authkitLoader', () => {
      // authkitLoader TESTS HERE
    });
  });
});
