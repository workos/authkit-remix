export abstract class Platform {
  /**
   * Get the value of an environment variable.
   * @param name The name of the environment variable.
   * @returns The value of the environment variable, or undefined if it is not set.
   */
  abstract getEnvVariable(name: string): string | undefined;

  /**
   * Get the value of an environment variable and throw an error if it is not set.
   * @param name The name of the environment variable.
   * @returns The value of the environment variable.
   */
  getRequiredEnvVariable(name: string): string {
    const value = this.getEnvVariable(name);
    if (value === undefined) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
  }
}

export class NodePlatform extends Platform {
  getEnvVariable(name: string): string | undefined {
    return process.env[name];
  }
}

export class CloudflarePlatform extends Platform {
  private env: Record<string, string>;

  constructor(env: Record<string, string>) {
    super();
    this.env = env;
  }

  getEnvVariable(name: string): string | undefined {
    return this.env[name];
  }
}
