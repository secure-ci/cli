import Docker from 'dockerode';
import { logger } from '../utils/logger';

/**
 * Options for Docker command execution
 */
export interface DockerExecutionOptions {
  command: string | string[];
  image?: string;
  env?: Record<string, string>;
  workingDir?: string;
  timeout?: number;
  memoryLimit?: string;
  disableNetwork?: boolean;
  shell?: string;
}

/**
 * Result of Docker command execution
 */
export interface DockerExecutionResult {
  success: boolean;
  output: string;
  exitCode: number;
  duration: number;
}

/**
 * Executor for running commands in Docker containers
 */
export class DockerExecutor {
  private docker: Docker;
  private availableCache: boolean | null = null;

  constructor() {
    this.docker = new Docker();
  }

  /**
   * Check if Docker daemon is available
   * Result is cached for performance
   */
  async isAvailable(): Promise<boolean> {
    if (this.availableCache !== null) {
      return this.availableCache;
    }

    try {
      await this.docker.ping();
      this.availableCache = true;
      logger.debug('Docker daemon is available');
      return true;
    } catch (error) {
      this.availableCache = false;
      logger.debug('Docker daemon is not available');
      return false;
    }
  }

  /**
   * Execute a command in a Docker container
   */
  async execute(
    options: DockerExecutionOptions
  ): Promise<DockerExecutionResult> {
    const startTime = Date.now();
    const image = options.image || 'ubuntu:22.04';

    // Ensure image is available
    await this.ensureImage(image);

    // Create container
    const container = await this.createContainer({
      image,
      command: options.command,
      env: options.env,
      workingDir: options.workingDir,
      memoryLimit: options.memoryLimit,
      disableNetwork: options.disableNetwork ?? true, // Network access disabled by default for security
      shell: options.shell || 'sh'
    });

    let timeoutHandle: NodeJS.Timeout | null = null;
    let cleanedUp = false;

    try {
      // Start container
      await container.start();

      // Set up timeout
      const timeout = options.timeout || 300000;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(async () => {
          // Try to stop the container on timeout
          try {
            await container.stop();
          } catch {
            // Ignore errors when stopping
          }
          reject(new Error(`Container execution timed out after ${timeout}ms`));
        }, timeout);
      });

      // Attach to output streams
      const stream = await container.logs({
        stdout: true,
        stderr: true,
        follow: true
      });

      // Collect output
      let output = '';
      stream.on('data', (chunk: Buffer) => {
        output += this.cleanDockerOutput(chunk);
      });

      // Wait for stream to complete
      await new Promise<void>((resolve) => {
        stream.on('end', resolve);
      });

      // Wait for container with timeout
      const result = await Promise.race([
        container.wait(),
        timeoutPromise
      ]);

      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      return {
        success: result.StatusCode === 0,
        output: output.trim(),
        exitCode: result.StatusCode,
        duration: Date.now() - startTime
      };
    } catch (error) {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      // Cleanup once on error
      await this.cleanup(container);
      cleanedUp = true;
      throw error;
    } finally {
      // Only cleanup if not already done
      if (!cleanedUp) {
        await this.cleanup(container);
      }
    }
  }

  /**
   * Ensure Docker image is available locally, pull if needed
   */
  private async ensureImage(image: string): Promise<void> {
    try {
      await this.docker.getImage(image).inspect();
      logger.debug(`Image ${image} already available`);
    } catch {
      logger.info(`Pulling Docker image: ${image}...`);
      await this.pullImage(image);
      logger.success(`Image ${image} pulled successfully`);
    }
  }

  /**
   * Pull a Docker image
   */
  private async pullImage(image: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
        if (err) return reject(err);

        this.docker.modem.followProgress(
          stream,
          (err: Error | null) => {
            if (err) return reject(err);
            resolve();
          },
          (event: { status?: string; progress?: string }) => {
            // Progress logging
            if (event.status) {
              logger.debug(`${event.status} ${event.progress || ''}`);
            }
          }
        );
      });
    });
  }

  /**
   * Create a Docker container with the specified configuration
   */
  private async createContainer(config: {
    image: string;
    command: string | string[];
    env?: Record<string, string>;
    workingDir?: string;
    memoryLimit?: string;
    disableNetwork: boolean;
    shell: string;
  }): Promise<Docker.Container> {
    // Prepare environment variables
    const envArray: string[] = [];
    if (config.env) {
      for (const [key, value] of Object.entries(config.env)) {
        envArray.push(`${key}=${value}`);
      }
    }

    // Prepare command
    const cmd = Array.isArray(config.command) ? config.command : [config.shell, '-c', config.command];

    // Container configuration
    const containerConfig: Docker.ContainerCreateOptions = {
      Image: config.image,
      Cmd: cmd,
      Env: envArray.length > 0 ? envArray : undefined,
      WorkingDir: config.workingDir,
      AttachStdout: true,
      AttachStderr: true,
      HostConfig: {
        Memory: config.memoryLimit ? this.parseMemoryLimit(config.memoryLimit) : undefined,
        NetworkMode: config.disableNetwork ? 'none' : 'bridge',
        AutoRemove: false // We'll handle removal ourselves for better control
      }
    };

    return await this.docker.createContainer(containerConfig);
  }

  /**
   * Clean up container after execution
   */
  private async cleanup(container: Docker.Container): Promise<void> {
    try {
      await container.remove({ force: true });
      logger.debug('Container cleaned up successfully');
    } catch (error) {
      logger.warn(
        `Failed to remove container: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Clean Docker output by removing header bytes
   * Docker multiplexes stdout/stderr with 8-byte headers
   */
  private cleanDockerOutput(chunk: Buffer): string {
    // Docker stream format: [stream_type, 0, 0, 0, size1, size2, size3, size4, ...data]
    // We need to strip these 8-byte headers
    let result = '';
    let offset = 0;

    while (offset < chunk.length) {
      if (chunk.length - offset < 8) {
        // Not enough bytes for a header, treat as raw data
        result += chunk.slice(offset).toString('utf8');
        break;
      }

      // Read the size from bytes 4-7 (big-endian)
      const size = chunk.readUInt32BE(offset + 4);

      if (size === 0 || offset + 8 + size > chunk.length) {
        // Invalid size or not enough data, treat as raw data
        result += chunk.slice(offset).toString('utf8');
        break;
      }

      // Extract the actual data (skip 8-byte header)
      result += chunk.slice(offset + 8, offset + 8 + size).toString('utf8');
      offset += 8 + size;
    }

    return result;
  }

  /**
   * Parse memory limit string to bytes
   */
  private parseMemoryLimit(limit: string): number {
    const match = limit.match(/^(\d+)(b|k|m|g)?$/i);
    if (!match) {
      throw new Error(`Invalid memory limit format: ${limit}`);
    }

    const value = parseInt(match[1], 10);
    const unit = (match[2] || 'b').toLowerCase();

    const multipliers: Record<string, number> = {
      b: 1,
      k: 1024,
      m: 1024 * 1024,
      g: 1024 * 1024 * 1024
    };

    return value * multipliers[unit];
  }
}

/**
 * Singleton instance for the Docker executor
 */
let dockerExecutorInstance: DockerExecutor | null = null;

/**
 * Get the singleton DockerExecutor instance
 */
export function getDockerExecutor(): DockerExecutor {
  if (!dockerExecutorInstance) {
    dockerExecutorInstance = new DockerExecutor();
  }
  return dockerExecutorInstance;
}
