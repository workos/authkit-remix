import { getSignInUrl, getSignUpUrl, signOut, switchToOrganization, withAuth } from './auth.js';
import { authLoader } from './authkit-callback-route.js';
import { configure, getConfig } from './config.js';
import { authkitLoader } from './session.js';
import { getWorkOS } from './workos.js';

export {
  authLoader,
  //
  authkitLoader,
  configure,
  getConfig,
  //
  getSignInUrl,
  getSignUpUrl,
  getWorkOS,
  signOut,
  switchToOrganization,
  withAuth,
};
