import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  Autocomplete,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
} from "./autocomplete";
import {
  Combobox,
  ComboboxChips,
  ComboboxChipsInput,
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

describe.each(["single", "multiple"])("%s combobox soft selection", (kind) => {
  it("highlights narrowed results without changing the value until Enter", async () => {
    const change = vi.fn();
    render(
      <Combobox
        items={items}
        multiple={kind === "multiple"}
        onValueChange={change}
      >
        {kind === "multiple" ? (
          <ComboboxChips>
            <ComboboxChipsInput aria-label="People" />
          </ComboboxChips>
        ) : (
          <ComboboxInput aria-label="People" />
        )}
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
    fireEvent.input(input, { target: { value: "a" }, inputType: "insertText" });
    await vi.waitFor(() =>
      expect(input).toHaveAttribute(
        "aria-activedescendant",
        screen.getByRole("option", { name: "Alpha" }).id,
      ),
    );
    fireEvent.input(input, {
      target: { value: "Be" },
      inputType: "insertText",
    });
    const beta = await screen.findByRole("option", { name: "Beta" });
    await vi.waitFor(() =>
      expect(input).toHaveAttribute("aria-activedescendant", beta.id),
    );
    expect(beta).toHaveAttribute("data-highlighted");
    expect(beta).toHaveAttribute("aria-selected", "false");
    expect(change).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(change).toHaveBeenCalledWith(
      kind === "multiple" ? ["Beta"] : "Beta",
      expect.anything(),
    );
  });
});

describe.each(["autocomplete", "command"])("%s soft selection", (kind) => {
  it("confirms the filtered suggestion with Enter", async () => {
    const select = vi.fn();
    render(
      kind === "command" ? (
        <Command items={items}>
          <CommandInput aria-label="Commands" />
          <CommandList>
            {(item: string) => (
              <CommandItem key={item} value={item} onClick={() => select(item)}>
                {item}
              </CommandItem>
            )}
          </CommandList>
        </Command>
      ) : (
        <Autocomplete items={items}>
          <AutocompleteInput aria-label="Suggestions" />
          <AutocompletePopup>
            <AutocompleteList>
              {(item: string) => (
                <AutocompleteItem
                  key={item}
                  value={item}
                  onClick={() => select(item)}
                >
                  {item}
                </AutocompleteItem>
              )}
            </AutocompleteList>
          </AutocompletePopup>
        </Autocomplete>
      ),
    );
    const input = screen.getByRole("combobox");
    input.focus();
    fireEvent.input(input, {
      target: { value: "Be" },
      inputType: "insertText",
    });
    const beta = await screen.findByRole("option", { name: "Beta" });
    await vi.waitFor(() =>
      expect(input).toHaveAttribute("aria-activedescendant", beta.id),
    );
    expect(select).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(select).toHaveBeenCalledWith("Beta");
  });
});
