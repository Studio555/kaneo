/**
 * Date features (due dates, start dates, the Gantt and Calendar views,
 * due-date reminders and time tracking) are disabled instance-wide by
 * `DISABLE_DATES=true`. Anything else, including unset, leaves them enabled so
 * an upgrade never silently turns the feature off.
 *
 * Read at call time rather than module load so tests can toggle it.
 */
export function areDatesEnabled(): boolean {
  return process.env.DISABLE_DATES !== "true";
}
