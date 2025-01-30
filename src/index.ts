import { authLoader } from './authkit-callback-route.js';
import { authkitLoader } from './session.js';
import { getSignInUrl, getSignUpUrl, signOut } from './auth.js';
import { initializePlatform } from './env-variables.js';
import { CloudflarePlatform, NodePlatform } from './platform.js';

function initialize(env?: Record<string, string>) {
  if (typeof process !== 'undefined' && process.env) {
    initializePlatform(new NodePlatform());
  } else if (env) {
    initializePlatform(new CloudflarePlatform(env));
  } else {
    throw new Error('No platform environment detected.');
  }
}

export {
  initialize,
  authLoader,
  //
  getSignInUrl,
  getSignUpUrl,
  signOut,
  //
  authkitLoader,
};
