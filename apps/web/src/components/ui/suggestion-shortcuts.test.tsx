import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Combobox,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
} from "./combobox";
import { Command, CommandInput, CommandItem, CommandList } from "./command";

const items = ["Alpha", "Beta", "Gamma"];
afterEach(cleanup);
describe.each(["j", "n", "k", "p"])(
  "Ctrl+%s in native suggestion inputs",
  (key) => {
    it("navigates command results and Enter invokes the highlighted action", async () => {
      const select = vi.fn();
      render(
        <Command items={items}>
          <CommandInput aria-label="Commands" />
          <CommandList>
            {(item: string) => (
              <CommandItem key={item} value={item} onClick={() => select(item)}>
                {item}
              </CommandItem>
            )}
          </CommandList>
        </Command>,
      );
      const input = screen.getByRole("combobox");
      input.focus();
      await vi.waitFor(() =>
        expect(input).toHaveAttribute("aria-activedescendant"),
      );
      const initial = input.getAttribute("aria-activedescendant");
      fireEvent.keyDown(input, { key, ctrlKey: true });
      await vi.waitFor(() =>
        expect(input.getAttribute("aria-activedescendant")).not.toBe(initial),
      );
      const highlighted = document.getElementById(
        input.getAttribute("aria-activedescendant") ?? "",
      );
      expect(highlighted).toHaveAttribute("data-highlighted");
      fireEvent.keyDown(input, { key: "Enter" });
      expect(select).toHaveBeenCalledWith(highlighted?.textContent);
    });
    it("navigates combobox options using the existing arrow-key behavior", async () => {
      const change = vi.fn();
      render(
        <Combobox items={items} onValueChange={change}>
          <ComboboxInput aria-label="People" />
          <ComboboxPopup>
            <ComboboxList>
              {(item: string) => (
                <ComboboxItem key={item} value={item}>
                  {item}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxPopup>
        </Combobox>,
      );
      const input = screen.getByRole("combobox");
      input.focus();
      fireEvent.keyDown(input, { key: "ArrowDown" });
      await screen.findByRole("option", { name: "Alpha" });
      if (key === "k" || key === "p") {
        fireEvent.keyDown(input, { key: "ArrowDown" });
        await vi.waitFor(() => {
          const active = document.getElementById(
            input.getAttribute("aria-activedescendant") ?? "",
          );
          expect(active).toHaveTextContent("Beta");
        });
      }
      fireEvent.keyDown(input, { key, ctrlKey: true });
      await vi.waitFor(() =>
        expect(input).toHaveAttribute("aria-activedescendant"),
      );
      const highlighted = document.getElementById(
        input.getAttribute("aria-activedescendant") ?? "",
      );
      fireEvent.keyDown(input, { key: "Enter" });
      expect(change).toHaveBeenCalledWith(
        highlighted?.textContent,
        expect.anything(),
      );
    });
  },
);
