import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mockConfig = vi.hoisted(() => ({ value: undefined as unknown }));

vi.mock("@/hooks/queries/config/use-get-config", () => ({
  default: () => ({ data: mockConfig.value }),
}));

import { useDatesEnabled, useDatesKnownDisabled } from "./use-dates-enabled";

describe("useDatesEnabled", () => {
  it("is false while the config query is still loading", () => {
    mockConfig.value = undefined;
    expect(renderHook(() => useDatesEnabled()).result.current).toBe(false);
  });

  it("is false when the instance disables dates", () => {
    mockConfig.value = { datesEnabled: false };
    expect(renderHook(() => useDatesEnabled()).result.current).toBe(false);
  });

  it("is true when the instance enables dates", () => {
    mockConfig.value = { datesEnabled: true };
    expect(renderHook(() => useDatesEnabled()).result.current).toBe(true);
  });
});

describe("useDatesKnownDisabled", () => {
  it("is false while the config query is still loading", () => {
    mockConfig.value = undefined;
    expect(renderHook(() => useDatesKnownDisabled()).result.current).toBe(
      false,
    );
  });

  it("is true only once the instance has answered that dates are off", () => {
    mockConfig.value = { datesEnabled: false };
    expect(renderHook(() => useDatesKnownDisabled()).result.current).toBe(true);
  });

  it("is false when the instance enables dates", () => {
    mockConfig.value = { datesEnabled: true };
    expect(renderHook(() => useDatesKnownDisabled()).result.current).toBe(
      false,
    );
  });
});
