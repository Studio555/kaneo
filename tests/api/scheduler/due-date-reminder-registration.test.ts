import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getScheduledJobDefinitions } from "../../../apps/api/src/scheduler/index";

vi.mock("../../../apps/api/src/scheduler/due-date-reminders", () => ({
  checkDueDateReminders: vi.fn(),
}));
vi.mock("../../../apps/api/src/scheduler/project-webhook-reminders", () => ({
  checkProjectWebhookReminders: vi.fn(),
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

  it("leaves the other jobs untouched when dates are disabled", () => {
    process.env.DISABLE_DATES = "true";
    const names = getScheduledJobDefinitions().map((job) => job.name);

    expect(names).toEqual([
      "project-webhook-reminders",
      "seat-reconciliation",
      "trial-reminders",
    ]);
  });
});
