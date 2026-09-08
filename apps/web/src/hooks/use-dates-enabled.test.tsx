import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mockConfig = vi.hoisted(() => ({
  value: undefined as unknown,
  isSuccess: false,
}));

vi.mock("@/hooks/queries/config/use-get-config", () => ({
  default: () => ({ data: mockConfig.value, isSuccess: mockConfig.isSuccess }),
}));

/** Config resolved with this payload. */
function resolved(value: unknown) {
  mockConfig.value = value;
  mockConfig.isSuccess = true;
}

/** Config query still in flight, or failed. */
function unresolved() {
  mockConfig.value = undefined;
  mockConfig.isSuccess = false;
}

import { useDatesEnabled, useDatesKnownDisabled } from "./use-dates-enabled";

describe("useDatesEnabled", () => {
  it("is false while the config query is still loading", () => {
    unresolved();
    expect(renderHook(() => useDatesEnabled()).result.current).toBe(false);
  });

  it("is false when the instance disables dates", () => {
    resolved({ datesEnabled: false });
    expect(renderHook(() => useDatesEnabled()).result.current).toBe(false);
  });

  it("is true when the instance enables dates", () => {
    resolved({ datesEnabled: true });
    expect(renderHook(() => useDatesEnabled()).result.current).toBe(true);
  });

  // The web app and the API can be deployed separately, so a newer web build
  // can reach an API that predates the flag. Reading that silence as "disabled"
  // would hide every date feature on an instance that never opted out.
  it("is true when an older API omits the field entirely", () => {
    resolved({ disableRegistration: false });
    expect(renderHook(() => useDatesEnabled()).result.current).toBe(true);
  });
});

describe("useDatesKnownDisabled", () => {
  it("is false while the config query is still loading", () => {
    unresolved();
    expect(renderHook(() => useDatesKnownDisabled()).result.current).toBe(
      false,
    );
  });

  it("is true only once the instance has answered that dates are off", () => {
    resolved({ datesEnabled: false });
    expect(renderHook(() => useDatesKnownDisabled()).result.current).toBe(true);
  });

  it("is false when the instance enables dates", () => {
    resolved({ datesEnabled: true });
    expect(renderHook(() => useDatesKnownDisabled()).result.current).toBe(
      false,
    );
  });

  // An older API that omits the field has not said dates are off, so nothing
  // may redirect on it.
  it("is false when an older API omits the field entirely", () => {
    resolved({ disableRegistration: false });
    expect(renderHook(() => useDatesKnownDisabled()).result.current).toBe(
      false,
    );
  });
});
