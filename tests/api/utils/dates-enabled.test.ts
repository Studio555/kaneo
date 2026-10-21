import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { areDatesEnabled } from "../../../apps/api/src/utils/dates-enabled";

describe("areDatesEnabled", () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env.DISABLE_DATES;
    delete process.env.DISABLE_DATES;
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.DISABLE_DATES;
    } else {
      process.env.DISABLE_DATES = original;
    }
  });

  it("is enabled when the variable is unset", () => {
    expect(areDatesEnabled()).toBe(true);
  });

  it("is disabled only for the exact string 'true'", () => {
    process.env.DISABLE_DATES = "true";
    expect(areDatesEnabled()).toBe(false);
  });

  it("stays enabled for any other value", () => {
    for (const value of ["false", "TRUE", "1", "yes", ""]) {
      process.env.DISABLE_DATES = value;
      expect(areDatesEnabled()).toBe(true);
    }
  });
});
