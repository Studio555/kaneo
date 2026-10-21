import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { CardFieldToggles } from "./card-field-toggles";

const datesEnabled = vi.hoisted(() => ({ value: true }));

vi.mock("@/hooks/use-dates-enabled", () => ({
  useDatesEnabled: () => datesEnabled.value,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

afterEach(() => {
  cleanup();
  datesEnabled.value = true;
});

describe("CardFieldToggles", () => {
  it("offers the due-date toggle when dates are enabled", () => {
    render(<CardFieldToggles />);

    expect(
      screen.getByRole("button", { name: "settings:preferencesPage.dueDates" }),
    ).toBeTruthy();
  });

  it("hides the due-date toggle when dates are disabled", () => {
    datesEnabled.value = false;
    render(<CardFieldToggles />);

    expect(
      screen.queryByRole("button", {
        name: "settings:preferencesPage.dueDates",
      }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "settings:preferencesPage.labels" }),
    ).toBeTruthy();
  });
});
