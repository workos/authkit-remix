import type { AuthKitConfig } from './interfaces.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ValueSource = Record<string, any> | ((key: string) => any);

/**
 * Default values for optional configuration settings
 */
export const DEFAULTS = {
  cookieName: 'wos-session',
  apiHttps: true,
  // Defaults to 400 days, the maximum allowed by Chrome
  // It's fine to have a long cookie expiry date as the access/refresh tokens
  // act as the actual time-limited aspects of the session.
  cookieMaxAge: 60 * 60 * 24 * 400,
  apiHostname: 'api.workos.com',
} as const;

/**
 * List of required configuration keys
 */
const REQUIRED_KEYS: (keyof AuthKitConfig)[] = ['clientId', 'apiKey', 'redirectUri', 'cookiePassword'];

/**
 * Convert a camelCase string to an uppercase, underscore-separated environment variable name.
 */
function getEnvironmentVariableName(str: string) {
  return `WORKOS_${str.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}`;
}

/**
 * Default environment variable source that uses process.env
 */
const defaultSource: ValueSource = (key: string): string | undefined => {
  try {
    return typeof process !== 'undefined' && process.env ? process.env[key] : undefined;
  } catch {
    return undefined;
  }
};

let configValues: Partial<AuthKitConfig> = {};
let valueSource: ValueSource = defaultSource;

/**
 * Configure AuthKit with a custom value source.
 * @param source The source of configuration values
 *
 * @example
 * configure(key => Deno.env.get(key));
 */
export function configure(source: ValueSource): void;
/**
 * Configure AuthKit with custom values.
 * @param config The configuration values
 *
 * @example
 * configure({
 *    clientId: 'your-client-id',
 *    redirectUri: 'https://your-app.com/auth/callback',
 *    apiKey: 'your-api-key',
 *    cookiePassword: 'your-cookie-password',
 *  });
 */
export function configure(config: Partial<AuthKitConfig>): void;
/**
 * Configure AuthKit with custom values and a custom value source.
 * @param config The configuration values
 * @param source The source of configuration values
 *
 * @example
 * configure({
 *   clientId: 'your-client-id',
 * }, env);
 */
export function configure(config: Partial<AuthKitConfig>, source: ValueSource): void;
export function configure(configOrSource: Partial<AuthKitConfig> | ValueSource, source?: ValueSource): void {
  if (typeof configOrSource === 'function') {
    valueSource = configOrSource;
  } else if (typeof configOrSource === 'object' && !source) {
    configValues = { ...configValues, ...configOrSource };
  } else if (typeof configOrSource === 'object' && source) {
    configValues = { ...configValues, ...configOrSource };
    valueSource = source;
  }

  // Validate the cookiePassword if provided
  if (configValues.cookiePassword && configValues.cookiePassword.length < 32) {
    throw new Error('cookiePassword must be at least 32 characters long');
  }
}

/**
 * Get a configuration value by key.
 * This function will first check environment variables, then programmatically provided config,
 * and finally fall back to defaults for optional settings.
 * If a required setting is missing, an error will be thrown.
 * @param key The configuration key
 * @returns The configuration value
 */
export function getConfig<K extends keyof AuthKitConfig>(key: K): AuthKitConfig[K] {
  // First check environment variables
  const envKey = getEnvironmentVariableName(key);
  let envValue: AuthKitConfig[K] | undefined = undefined;

  if (typeof valueSource === 'function') {
    envValue = valueSource(envKey);
  } else if (valueSource && envKey in valueSource) {
    envValue = valueSource[envKey];
  }

  // If environment variable exists, use it
  if (envValue != null) {
    // Convert string values to appropriate types
    if (key === 'apiHttps' && typeof envValue === 'string') {
      return (envValue === 'true') as AuthKitConfig[K];
    }

    if ((key === 'apiPort' || key === 'cookieMaxAge') && typeof envValue === 'string') {
      const num = parseInt(envValue, 10);
      return (isNaN(num) ? undefined : num) as AuthKitConfig[K];
    }

    return envValue as AuthKitConfig[K];
  }

  // Then check programmatically provided config
  if (key in configValues && configValues[key] != undefined) {
    return configValues[key] as AuthKitConfig[K];
  }

  // Finally, check defaults for optional settings
  if (key in DEFAULTS) {
    return DEFAULTS[key as keyof typeof DEFAULTS] as NonNullable<AuthKitConfig[K]>;
  }

  if (REQUIRED_KEYS.includes(key)) {
    throw new Error(`Missing required configuration value for ${key} (${envKey}).`);
  }

  return undefined as AuthKitConfig[K];
}
