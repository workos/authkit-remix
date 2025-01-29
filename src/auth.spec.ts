import { getSignInUrl, getSignUpUrl, signOut } from './auth';
import * as authorizationUrl from './get-authorization-url';
import * as session from './session';

const terminateSession = jest.mocked(session.terminateSession);

jest.mock('./session', () => ({
  terminateSession: jest.fn().mockResolvedValue(new Response()),
}));

describe('auth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(authorizationUrl, 'getAuthorizationUrl');
  });

  describe('getSignInUrl', () => {
    it('should return a URL', async () => {
      expect(await getSignInUrl('/test')).toMatch(/^https:\/\/api\.workos\.com/);
      expect(authorizationUrl.getAuthorizationUrl).toHaveBeenCalledWith(
        expect.objectContaining({ returnPathname: '/test', screenHint: 'sign-in' }),
      );
    });
  });

  describe('getSignUpUrl', () => {
    it('should return a URL', async () => {
      expect(await getSignUpUrl()).toMatch(/^https:\/\/api\.workos\.com/);
      expect(authorizationUrl.getAuthorizationUrl).toHaveBeenCalledWith(
        expect.objectContaining({ screenHint: 'sign-up' }),
      );
    });
  });

  describe('signOut', () => {
    it('should return a response', async () => {
      const request = new Request('https://example.com');
      const response = await signOut(request);
      expect(response).toBeInstanceOf(Response);
      expect(terminateSession).toHaveBeenCalledWith(request);
    });
  });
});
