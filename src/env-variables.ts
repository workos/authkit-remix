import { NodePlatform, type Platform } from './platform.js';

let platform: Platform = new NodePlatform();

export function initializePlatform(p: Platform) {
  platform = p;
}

export function getEnvVariable(name: string): string {
  return platform.getRequiredEnvVariable(name);
}

export function getOptionalEnvVariable(name: string): string | undefined {
  return platform.getEnvVariable(name);
}
