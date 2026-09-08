import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getScheduledJobDefinitions } from "../../../apps/api/src/scheduler/index";
import { checkProjectWebhookReminders } from "../../../apps/api/src/scheduler/project-webhook-reminders";

vi.mock("../../../apps/api/src/scheduler/due-date-reminders", () => ({
  checkDueDateReminders: vi.fn(),
}));
vi.mock("../../../apps/api/src/scheduler/project-webhook-reminders", () => ({
  checkProjectWebhookReminders: vi.fn(async () => ({ degraded: false })),
}));
vi.mock("../../../apps/api/src/scheduler/seat-reconciliation", () => ({
  reconcileWorkspaceSeats: vi.fn(),
}));
vi.mock("../../../apps/api/src/scheduler/trial-reminders", () => ({
  checkTrialReminders: vi.fn(),
}));

describe("scheduler due-date reminder registration", () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env.DISABLE_DATES;
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.DISABLE_DATES;
    } else {
      process.env.DISABLE_DATES = original;
    }
  });

  it("excludes due-date-reminders when dates are disabled", () => {
    process.env.DISABLE_DATES = "true";
    const names = getScheduledJobDefinitions().map((job) => job.name);

    expect(names).not.toContain("due-date-reminders");
  });

  it("includes due-date-reminders when dates are enabled", () => {
    delete process.env.DISABLE_DATES;
    const names = getScheduledJobDefinitions().map((job) => job.name);

    expect(names).toContain("due-date-reminders");
  });

  it("leaves the non-date jobs untouched when dates are disabled", () => {
    process.env.DISABLE_DATES = "true";
    const names = getScheduledJobDefinitions().map((job) => job.name);

    expect(names).toEqual(["seat-reconciliation", "trial-reminders"]);
  });
});

describe("scheduler webhook due-date reminder registration", () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env.DISABLE_DATES;
    vi.mocked(checkProjectWebhookReminders).mockClear();
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.DISABLE_DATES;
    } else {
      process.env.DISABLE_DATES = original;
    }
  });

  // The webhook reminder job posts due-date reminders to customer endpoints
  // and writes dedupe rows; on a disabled instance the UI toggle that would
  // stop it is hidden, so nothing may run it at all.
  it("produces no webhook due-date reminder while dates are disabled", async () => {
    process.env.DISABLE_DATES = "true";

    for (const job of getScheduledJobDefinitions()) {
      await job.run();
    }

    expect(checkProjectWebhookReminders).not.toHaveBeenCalled();
  });

  it("still runs the webhook due-date reminder when dates are enabled", async () => {
    delete process.env.DISABLE_DATES;

    for (const job of getScheduledJobDefinitions()) {
      await job.run();
    }

    expect(checkProjectWebhookReminders).toHaveBeenCalledTimes(1);
  });
});
