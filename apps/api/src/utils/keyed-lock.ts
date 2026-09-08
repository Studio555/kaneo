const tails = new Map<string, Promise<void>>();

/**
 * Runs `fn` with no other holder of `key` in flight, queueing callers in
 * arrival order. In-process only: the event bus dispatches plugin handlers on
 * the instance that handled the request, so a key never spans instances.
 */
export async function withKeyedLock<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = tails.get(key);

  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  const tail = (previous ?? Promise.resolve()).then(
    () => held,
    () => held,
  );
  tails.set(key, tail);

  if (previous) {
    await previous.catch(() => undefined);
  }

  try {
    return await fn();
  } finally {
    release?.();
    // Whoever queued behind us has already replaced the tail; only the last
    // holder clears the key, so the map does not grow for the process's life.
    if (tails.get(key) === tail) {
      tails.delete(key);
    }
  }
}
