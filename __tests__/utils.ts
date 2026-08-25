import { describe, it, expect, vi } from 'vitest';
import { performance } from 'perf_hooks';

/**
 * Wrap a test function with a soft timeout that rejects past `timeoutMs` and
 * warns when the function runs past 80% of the budget. Once timed out, any
 * later resolution from the wrapped function is ignored, so a slow `testFn`
 * cannot log after the test has torn down.
 */
export function withTimeout<T>(
  testFn: () => Promise<T>,
  timeoutMs: number = 5000,
  testName: string = 'unnamed test'
): Promise<T> {
  const startTime = performance.now();
  let settled = false;

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      const elapsed = performance.now() - startTime;
      reject(new Error(`Test "${testName}" took ${elapsed.toFixed(2)}ms (exceeded ${timeoutMs}ms timeout)`));
    }, timeoutMs);

    testFn()
      .then((result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        const elapsed = performance.now() - startTime;
        if (elapsed > timeoutMs * 0.8) {
          console.warn(`Warning: Test "${testName}" took ${elapsed.toFixed(2)}ms (80% of ${timeoutMs}ms timeout)`);
        }
        resolve(result);
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

describe('withTimeout utility', () => {
  it('resolves when test completes within timeout', async () => {
    const result = await withTimeout(async () => 'success', 1000, 'fast test');
    expect(result).toBe('success');
  });

  it('rejects when test exceeds timeout', async () => {
    await expect(withTimeout(
      async () => {
        await new Promise(resolve => setTimeout(resolve, 2000));
        return 'success';
      },
      1000,
      'slow test'
    )).rejects.toThrow('exceeded 1000ms timeout');
  });

  it('warns when test takes more than 80% of timeout', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

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
