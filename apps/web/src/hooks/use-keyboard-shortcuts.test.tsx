import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  KeyboardShortcutsProvider,
  useKeyboardShortcuts,
} from "./use-keyboard-shortcuts";

afterEach(cleanup);
describe("global shortcuts around suggestion inputs", () => {
  it("leaves handled Ctrl+K and composing events with the active input", () => {
    const openPalette = vi.fn();
    function Field() {
      const { registerModifierShortcut, unregisterModifierShortcut } =
        useKeyboardShortcuts();
      useEffect(() => {
        registerModifierShortcut("Ctrl", "k", openPalette);
        return () => unregisterModifierShortcut("Ctrl", "k");
      }, [registerModifierShortcut, unregisterModifierShortcut]);
      return (
        <input
          aria-label="Search"
          onKeyDown={(event) => {
            if (event.ctrlKey && event.key === "k") event.preventDefault();
          }}
        />
      );
    }
    render(
      <KeyboardShortcutsProvider>
        <Field />
      </KeyboardShortcutsProvider>,
    );
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "k", ctrlKey: true });
    expect(openPalette).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "k", ctrlKey: true, isComposing: true });
    expect(openPalette).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(openPalette).toHaveBeenCalledTimes(1);
  });
});
