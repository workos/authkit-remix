import type { AuthKitConfig } from './interfaces';

type ValueSource = Record<string, any> | ((key: string) => any);

/**
 * Convert a camelCase string to an uppercase, underscore-separated string.
 * @param str The camelCase string to convert
 * @returns The uppercase, underscore-separated string
 */
function getEnvironmentVariableName(str: string) {
  if (!str) {
    return '';
  }

  const value = str
    // Add underscore before uppercase letters that follow lowercase letters
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    // Handle consecutive uppercase letters followed by lowercase (like APIClient -> API_Client)
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    // Convert the entire string to uppercase
    .toUpperCase();

  return `WORKOS_${value}`;
}

const defaultSource = (key: string): string | undefined => {
  try {
    return typeof process !== 'undefined' && process.env ? process.env[key] : undefined;
  } catch {
    return undefined;
  }
};

let configValues: Partial<AuthKitConfig> = {};
let valueSource: ValueSource = defaultSource;
let isConfigured = false;

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
  if (isConfigured) {
    console.warn('AuthKit has already been configured. Ignoring additional configuration.');
    return;
  }

  if (typeof configOrSource === 'function' || typeof configOrSource === 'object') {
    valueSource = configOrSource;
  } else {
    configValues = configOrSource;
    valueSource = source ?? defaultSource;
  }

  isConfigured = true;
}

export function getConfig<K extends keyof AuthKitConfig>(key: K): AuthKitConfig[K] | undefined {
  if (key in configValues) {
    return configValues[key];
  }

  const envKey = getEnvironmentVariableName(key);
  let value: any;

  if (typeof valueSource === 'function') {
    value = valueSource(envKey);
  } else if (valueSource && envKey in valueSource) {
    value = valueSource[envKey];
  }

  if (key === 'apiHttps' && typeof value === 'string') {
    return (value === 'true') as AuthKitConfig[K];
  }

  if ((key === 'apiPort' || key === 'cookieMaxAge') && typeof value === 'string') {
    const num = parseInt(value, 10);
    return (isNaN(num) ? undefined : num) as AuthKitConfig[K];
  }

  return value as AuthKitConfig[K];
}

export function getRequiredConfig<K extends keyof AuthKitConfig>(key: K): NonNullable<AuthKitConfig[K]> {
  const value = getConfig(key);
  if (value == null) {
    throw new Error(`Missing required configuration value for ${key}`);
  }
  return value;
}
