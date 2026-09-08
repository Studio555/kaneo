import { HTTPException } from "hono/http-exception";
import { areDatesEnabled } from "./dates-enabled";

/**
 * Rejects setting a date while date features are disabled instance-wide.
 * Clearing (null/undefined) stays allowed so stale values can be stripped
 * without turning the feature back on.
 */
export function assertDatesEnabled(value: unknown): void {
  if (value === null || value === undefined) return;
  if (areDatesEnabled()) return;
  throw new HTTPException(422, {
    message: "Date fields are disabled on this instance",
  });
}

/**
 * Validates and parses a date string. Throws an HTTPException if the string
 * is empty or cannot be parsed into a valid Date.
 */
export function validateAndParseDate(dateStr: string, fieldName: string): Date {
  assertDatesEnabled(dateStr);
  if (dateStr.trim() === "") {
    throw new HTTPException(400, {
      message: `${fieldName} cannot be an empty string. Please provide a valid date or omit the field.`,
    });
  }
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) {
    throw new HTTPException(400, {
      message: `Invalid ${fieldName} "${dateStr}". Please provide a valid date string (e.g. "2025-01-15" or "2025-01-15T10:30:00Z").`,
    });
  }
  return parsed;
}

/**
 * Validates that startDate is not after dueDate when both are provided.
 * Throws an HTTPException if the date range is logically invalid.
 */
export function validateDateRange(
  startDate: Date | undefined | null,
  dueDate: Date | undefined | null,
): void {
  if (startDate && dueDate && startDate.getTime() > dueDate.getTime()) {
    throw new HTTPException(400, {
      message:
        "Start date cannot be after due date. Please adjust the date range.",
    });
  }
}
