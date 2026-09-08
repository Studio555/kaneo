import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertDatesEnabled,
  validateAndParseDate,
  validateDateRange,
} from "../../../apps/api/src/utils/validate-dates";

describe("validateAndParseDate", () => {
  it("should parse a valid ISO date string", () => {
    const result = validateAndParseDate("2026-08-01T00:00:00.000Z", "dueDate");
    expect(result).toBeInstanceOf(Date);
    expect(result.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("should parse a date-only string", () => {
    const result = validateAndParseDate("2026-08-01", "startDate");
    expect(result).toBeInstanceOf(Date);
    expect(Number.isNaN(result.getTime())).toBe(false);
  });

  it("should throw on an invalid date string", () => {
    expect(() => validateAndParseDate("not-a-date", "dueDate")).toThrowError(
      /Invalid dueDate/,
    );
  });

  it("should throw on an empty string", () => {
    expect(() => validateAndParseDate("", "startDate")).toThrowError(
      /startDate cannot be an empty string/,
    );
  });

  it("should throw on a whitespace-only string", () => {
    expect(() => validateAndParseDate("   ", "dueDate")).toThrowError(
      /dueDate cannot be an empty string/,
    );
  });

  it("should throw on a gibberish string", () => {
    expect(() => validateAndParseDate("abc123xyz", "dueDate")).toThrowError(
      /Invalid dueDate/,
    );
  });
});

describe("validateDateRange", () => {
  it("should not throw when startDate is before dueDate", () => {
    const start = new Date("2026-07-01");
    const due = new Date("2026-08-01");
    expect(() => validateDateRange(start, due)).not.toThrow();
  });

  it("should not throw when startDate equals dueDate", () => {
    const date = new Date("2026-08-01");
    expect(() => validateDateRange(date, date)).not.toThrow();
  });

  it("should throw when startDate is after dueDate", () => {
    const start = new Date("2026-09-01");
    const due = new Date("2026-08-01");
    expect(() => validateDateRange(start, due)).toThrowError(
      /Start date cannot be after due date/,
    );
  });

  it("should not throw when only startDate is provided", () => {
    const start = new Date("2026-08-01");
    expect(() => validateDateRange(start, undefined)).not.toThrow();
  });

  it("should not throw when only dueDate is provided", () => {
    const due = new Date("2026-08-01");
    expect(() => validateDateRange(undefined, due)).not.toThrow();
  });

  it("should not throw when both are null/undefined", () => {
    expect(() => validateDateRange(null, null)).not.toThrow();
    expect(() => validateDateRange(undefined, undefined)).not.toThrow();
  });
});

describe("assertDatesEnabled", () => {
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

  it("permits any value when dates are enabled", () => {
    delete process.env.DISABLE_DATES;
    expect(() => assertDatesEnabled("2026-08-01T00:00:00.000Z")).not.toThrow();
  });

  it("rejects a non-null value when dates are disabled", () => {
    process.env.DISABLE_DATES = "true";
    expect(() => assertDatesEnabled("2026-08-01T00:00:00.000Z")).toThrowError(
      /Date fields are disabled on this instance/,
    );
  });

  it("permits clearing when dates are disabled", () => {
    process.env.DISABLE_DATES = "true";
    expect(() => assertDatesEnabled(null)).not.toThrow();
    expect(() => assertDatesEnabled(undefined)).not.toThrow();
  });
});
