/**
 * Asks the instance whether date features are enabled so the date tools are
 * not advertised to an agent that would only get a 422 back.
 *
 * Fails open on every error path: this package is published and must keep
 * working against instances that predate the flag or are briefly unreachable.
 */
export async function fetchDatesEnabled(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/config`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return true;
    const payload = (await res.json()) as { datesEnabled?: unknown };
    return payload.datesEnabled !== false;
  } catch {
    return true;
  }
}
