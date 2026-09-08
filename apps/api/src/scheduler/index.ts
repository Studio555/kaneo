import * as Sentry from "@sentry/node";
import { Cron } from "croner";
import { areDatesEnabled } from "../utils/dates-enabled";
import { checkDueDateReminders } from "./due-date-reminders";
import { checkProjectWebhookReminders } from "./project-webhook-reminders";
import { reconcileWorkspaceSeats } from "./seat-reconciliation";
import { checkTrialReminders } from "./trial-reminders";

const jobs: Cron[] = [];

type JobOutcome = { degraded?: boolean };

// Cron jobs swallow their operational failures (per-item try/catch) so they
// can keep processing the rest of the batch. Reporting Sentry status purely
// from the thrown-rejection channel would always show "ok" for any partially
// failed run. Inspect the returned outcome instead so handled failures light
// up the monitor without aborting the rest of the work. Unexpected throws are
// captured as exception events and swallowed so one bad tick can't take down
// the scheduler via an unhandled rejection.
function withCheckIn<T>(name: string, fn: () => Promise<T>) {
  return async (): Promise<void> => {
    const checkInId = Sentry.captureCheckIn({
      monitorSlug: name,
      status: "in_progress",
    });
    try {
      const result = await fn();
      const degraded = Boolean(
        (result as JobOutcome | null | undefined)?.degraded,
      );
      Sentry.captureCheckIn({
        checkInId,
        monitorSlug: name,
        status: degraded ? "error" : "ok",
      });
    } catch (error) {
      Sentry.captureException(error, { tags: { area: "cron", job: name } });
      Sentry.captureCheckIn({
        checkInId,
        monitorSlug: name,
        status: "error",
      });
      console.error(`Cron job ${name} failed`, error);
    }
  };
}

type ScheduledJobDefinition = {
  name: string;
  pattern: string;
  run: () => Promise<unknown>;
};

// Exported so the scheduling policy can be asserted without constructing real
// cron timers: which jobs run is a decision; `new Cron` is only how it is carried out.
export function getScheduledJobDefinitions(): ScheduledJobDefinition[] {
  const definitions: ScheduledJobDefinition[] = [];
  // Both reminder jobs exist only to deliver due-date reminders — the webhook
  // one does no other work — so an instance with dates disabled registers
  // neither. Leaving the webhook job running would keep posting due-date
  // reminders to customers' endpoints (and writing dedupe rows) with no way
  // to turn it off, because the UI toggle for it is hidden while disabled.
  if (areDatesEnabled()) {
    definitions.push(
      {
        name: "due-date-reminders",
        pattern: "*/5 * * * *",
        run: checkDueDateReminders,
      },
      {
        name: "project-webhook-reminders",
        pattern: "*/5 * * * *",
        run: checkProjectWebhookReminders,
      },
    );
  }
  definitions.push(
    {
      name: "seat-reconciliation",
      pattern: "17 * * * *",
      run: reconcileWorkspaceSeats,
    },
    {
      name: "trial-reminders",
      pattern: "23 * * * *",
      run: checkTrialReminders,
    },
  );
  return definitions;
}

export function initializeScheduler(): void {
  const definitions = getScheduledJobDefinitions();
  for (const { name, pattern, run } of definitions) {
    jobs.push(new Cron(pattern, withCheckIn(name, run)));
  }
  // Names the jobs that were actually registered: which ones those are
  // depends on instance configuration, so a fixed sentence would lie.
  console.log(
    `⏰ Scheduler started (${definitions.map((job) => job.name).join(", ")})`,
  );
}

export function shutdownScheduler(): void {
  for (const job of jobs) {
    job.stop();
  }
  jobs.length = 0;
}
