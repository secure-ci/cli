import { DockerExecutor, getDockerExecutor } from './docker-executor';

describe('DockerExecutor', () => {
  let executor: DockerExecutor;

  beforeEach(() => {
    executor = new DockerExecutor();
  });

  describe('isAvailable', () => {
    it('should check Docker availability', async () => {
      const available = await executor.isAvailable();
      // Test passes regardless of Docker availability
      expect(typeof available).toBe('boolean');
    });

    it('should cache availability check result', async () => {
      const result1 = await executor.isAvailable();
      const result2 = await executor.isAvailable();
      
      // Both calls should return the same result
      expect(result1).toBe(result2);
    });
  });

  describe('execute', () => {
    // Skip tests if Docker is not available
    const skipIfDockerUnavailable = async () => {
      const available = await executor.isAvailable();
      if (!available) {
        console.log('Skipping Docker tests - Docker daemon not available');
        return true;
      }
      return false;
    };

    it('should execute a simple echo command', async () => {
      if (await skipIfDockerUnavailable()) return;

      const result = await executor.execute({
        command: 'echo "Hello from Docker"',
        image: 'ubuntu:22.04'
      });

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('Hello from Docker');
      expect(result.duration).toBeGreaterThan(0);
    }, 30000); // 30 second timeout for image pull

    it('should handle command failures with non-zero exit code', async () => {
      if (await skipIfDockerUnavailable()) return;

      const result = await executor.execute({
        command: 'exit 1',
        image: 'ubuntu:22.04'
      });

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    }, 30000);

    it('should pass environment variables to container', async () => {
      if (await skipIfDockerUnavailable()) return;

      const result = await executor.execute({
        command: 'echo $TEST_VAR',
        image: 'ubuntu:22.04',
        env: {
          TEST_VAR: 'test-value'
        }
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('test-value');
    }, 30000);

    it('should handle timeout for long-running commands', async () => {
      if (await skipIfDockerUnavailable()) return;

      await expect(
        executor.execute({
          command: 'sleep 10',
          image: 'ubuntu:22.04',
          timeout: 1000 // 1 second timeout
        })
      ).rejects.toThrow('timed out');
    }, 35000);

    it('should collect multi-line output', async () => {
      if (await skipIfDockerUnavailable()) return;

      const result = await executor.execute({
        command: 'echo "Line 1" && echo "Line 2" && echo "Line 3"',
        image: 'ubuntu:22.04'
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Line 1');
      expect(result.output).toContain('Line 2');
      expect(result.output).toContain('Line 3');
    }, 30000);

    it('should use custom Docker image', async () => {
      if (await skipIfDockerUnavailable()) return;

      const result = await executor.execute({
        command: 'node --version',
        image: 'node:20-alpine'
      });

      expect(result.success).toBe(true);
      expect(result.output).toMatch(/v20\.\d+\.\d+/);
    }, 60000); // Longer timeout for image pull

    it('should execute array commands', async () => {
      if (await skipIfDockerUnavailable()) return;

      const result = await executor.execute({
        command: ['echo', 'Array command'],
        image: 'ubuntu:22.04'
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Array command');
    }, 30000);

    it('should handle commands with stderr output', async () => {
      if (await skipIfDockerUnavailable()) return;

      const result = await executor.execute({
        command: 'echo "error message" >&2',
        image: 'ubuntu:22.04'
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('error message');
    }, 30000);

    it('should clean up container after execution', async () => {
      if (await skipIfDockerUnavailable()) return;

      const result = await executor.execute({
        command: 'echo "cleanup test"',
        image: 'ubuntu:22.04'
      });

      expect(result.success).toBe(true);
      // Container should be cleaned up automatically
      // We can't directly verify this, but execution should complete without errors
    }, 30000);
  });

  describe('getDockerExecutor', () => {
    it('should return a singleton instance', () => {
      const instance1 = getDockerExecutor();
      const instance2 = getDockerExecutor();

      expect(instance1).toBe(instance2);
    });

    it('should return a DockerExecutor instance', () => {
      const instance = getDockerExecutor();
      expect(instance).toBeInstanceOf(DockerExecutor);
    });
  });
});
