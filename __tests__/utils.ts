import { performance } from 'perf_hooks';

export function withTimeout<T>(
  testFn: () => Promise<T>,
  timeoutMs: number = 5000,
  testName: string = 'unnamed test'
): Promise<T> {
  const startTime = performance.now();
  
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      const elapsed = performance.now() - startTime;
      reject(new Error(`Test "${testName}" took ${elapsed.toFixed(2)}ms (exceeded ${timeoutMs}ms timeout)`));
    }, timeoutMs);

    testFn()
      .then((result) => {
        clearTimeout(timeoutId);
        const elapsed = performance.now() - startTime;
        if (elapsed > timeoutMs * 0.8) {
          console.warn(`Warning: Test "${testName}" took ${elapsed.toFixed(2)}ms (80% of ${timeoutMs}ms timeout)`);
        }
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

describe('withTimeout utility', () => {
  it('should resolve when test completes within timeout', async () => {
    const result = await withTimeout(
      async () => 'success',
      1000,
      'fast test'
    );
    expect(result).toBe('success');
  });

  it('should reject when test exceeds timeout', async () => {
    await expect(withTimeout(
      async () => {
        await new Promise(resolve => setTimeout(resolve, 2000));
        return 'success';
      },
      1000,
      'slow test'
    )).rejects.toThrow('exceeded 1000ms timeout');
  });

  it('should warn when test takes more than 80% of timeout', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
    
    await withTimeout(
      async () => {
        await new Promise(resolve => setTimeout(resolve, 800));
        return 'success';
      },
      1000,
      'warning test'
    );

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('80% of 1000ms timeout'));
    consoleSpy.mockRestore();
  });
}); 