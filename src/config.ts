import type { AuthKitConfig } from './interfaces';

type ValueSource = Record<string, any> | ((key: string) => any);

function getEnvironmentVariableName(str: string) {
  return `WORKOS_${str.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}`;
}

const defaultSource: ValueSource = (key: string): string | undefined =>
  typeof process !== 'undefined' && process.env ? process.env[key] : undefined;

let configValues: Partial<AuthKitConfig> = {};
let valueSource: ValueSource = defaultSource;
let isConfigured = false;

export function configure(configOrSource: Partial<AuthKitConfig> | ValueSource, source?: ValueSource): void {
  if (isConfigured) {
    console.warn('AuthKit has already been configured. Further configurations will be merged.');
  }

  if (typeof configOrSource === 'function') {
    valueSource = configOrSource;
  } else if (typeof configOrSource === 'object' && !source) {
    configValues = { ...configValues, ...configOrSource };
  } else if (typeof configOrSource === 'object' && source) {
    configValues = { ...configValues, ...configOrSource };
    valueSource = source;
  }

  isConfigured = true;
}

export function getConfig<K extends keyof AuthKitConfig>(key: K): AuthKitConfig[K] | undefined {
  if (key in configValues) {
    return configValues[key];
  }

  const envKey = getEnvironmentVariableName(key);
  let value: any = typeof valueSource === 'function' ? valueSource(envKey) : valueSource?.[envKey];

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
