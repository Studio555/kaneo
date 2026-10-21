import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Input } from "@/components/ui/input";
import { SuggestionInput } from "@/components/ui/suggestion-input";
import { useSuggestionNavigation } from "./use-suggestion-navigation";

const select = vi.fn();
const submit = vi.fn();
function Picker({ items = ["Alpha", "Beta", "Gamma"], enabled = true }) {
  const [query, setQuery] = useState("");
  const filtered = items.filter((item) =>
    item.toLowerCase().includes(query.toLowerCase()),
  );
  const navigation = useSuggestionNavigation({
    items: filtered,
    query,
    enabled,
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <SuggestionInput
        navigation={navigation.inputProps}
        aria-label="Search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <Input aria-label="Plain text" />
      <div {...navigation.listProps}>
        {filtered.map((item, index) => (
          <button
            {...navigation.getOptionProps(index)}
            type="button"
            key={item}
            onClick={() => select(item)}
          >
            {item}
          </button>
        ))}
      </div>
    </form>
  );
}
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const keys = [
  { key: "ArrowDown", direction: 1 },
  { key: "ArrowUp", direction: -1 },
  { key: "j", ctrlKey: true, direction: 1 },
  { key: "k", ctrlKey: true, direction: -1 },
  { key: "n", ctrlKey: true, direction: 1 },
  { key: "p", ctrlKey: true, direction: -1 },
];
describe("suggestion navigation", () => {
  it.each(keys)("highlights and selects using $key (Ctrl: $ctrlKey)", (key) => {
    render(<Picker />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    act(() => input.focus());
    fireEvent.keyDown(input, key);
    const item = screen.getByRole("option", {
      name: key.direction === 1 ? "Alpha" : "Gamma",
    });
    expect(item).toHaveAttribute("data-suggestion-highlighted", "true");
    expect(input).toHaveAttribute("aria-activedescendant", item.id);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(select).toHaveBeenCalledWith(item.textContent);
    expect(submit).not.toHaveBeenCalled();
    expect(input).toHaveFocus();
  });
  it("wraps and scrolls the highlight into view", () => {
    render(<Picker />);
    const input = screen.getByRole("combobox");
    act(() => input.focus());
    const last = screen.getByRole("option", { name: "Gamma" });
    last.scrollIntoView = vi.fn();
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(last.scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "Alpha" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
  it("soft highlights filtered results and clears the highlight on blur", () => {
    render(<Picker />);
    const input = screen.getByRole("combobox");
    act(() => input.focus());
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.change(input, { target: { value: "Beta" } });
    expect(screen.getByRole("option", { name: "Beta" })).toHaveAttribute(
      "data-suggestion-highlighted",
      "true",
    );
    expect(select).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(select).toHaveBeenCalledWith("Beta");
    expect(submit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "n", ctrlKey: true });
    expect(screen.getByRole("option", { name: "Beta" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    act(() => screen.getByRole("textbox").focus());
    expect(input).not.toHaveAttribute("aria-activedescendant");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).not.toHaveAttribute("aria-activedescendant");
    act(() => input.focus());
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      screen.getByRole("option", { name: "Beta" }).id,
    );
  });
  it("does not activate a removed result or submit an empty picker", () => {
    const { rerender } = render(<Picker />);
    const input = screen.getByRole("combobox");
    act(() => input.focus());
    fireEvent.keyDown(input, { key: "ArrowDown" });
    rerender(<Picker items={["Beta"]} />);
    expect(input).not.toHaveAttribute("aria-activedescendant");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(select).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "Missing" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(submit).not.toHaveBeenCalled();
  });
  it("updates the soft highlight as results narrow and supports manual navigation", () => {
    render(<Picker items={["Alpha", "Alpine", "Beta"]} />);
    const input = screen.getByRole("combobox");
    act(() => input.focus());
    fireEvent.change(input, { target: { value: "Al" } });
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      screen.getByRole("option", { name: "Alpha" }).id,
    );
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      screen.getByRole("option", { name: "Alpine" }).id,
    );
    fireEvent.change(input, { target: { value: "Alp" } });
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      screen.getByRole("option", { name: "Alpha" }).id,
    );
    fireEvent.change(input, { target: { value: "Alpi" } });
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      screen.getByRole("option", { name: "Alpine" }).id,
    );
    expect(select).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(select).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(select).toHaveBeenCalledWith("Alpine");
    expect(submit).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "Missing" } });
    expect(input).not.toHaveAttribute("aria-activedescendant");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(select).toHaveBeenCalledTimes(1);
  });
  it("soft highlights results that arrive after typing", () => {
    const { rerender } = render(<Picker items={[]} />);
    const input = screen.getByRole("combobox");
    act(() => input.focus());
    fireEvent.change(input, { target: { value: "Be" } });
    expect(input).not.toHaveAttribute("aria-activedescendant");
    rerender(<Picker items={["Beta"]} />);
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      screen.getByRole("option", { name: "Beta" }).id,
    );
    expect(select).not.toHaveBeenCalled();
  });
  it("ignores ordinary letters, extra modifiers, IME composition, and disabled navigation", () => {
    const { rerender } = render(<Picker />);
    const input = screen.getByRole("combobox");
    act(() => input.focus());
    for (const key of [
      { key: "j" },
      { key: "n", ctrlKey: true, altKey: true },
      { key: "ArrowDown", shiftKey: true },
      { key: "ArrowDown", isComposing: true },
    ])
      fireEvent.keyDown(input, key);
    expect(input).not.toHaveAttribute("aria-activedescendant");
    rerender(<Picker enabled={false} />);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).not.toHaveAttribute("aria-activedescendant");
  });
  it("follows the pointer only while the input is focused", () => {
    render(<Picker />);
    const input = screen.getByRole("combobox");
    const beta = screen.getByRole("option", { name: "Beta" });
    fireEvent.mouseMove(beta);
    expect(beta).toHaveAttribute("aria-selected", "false");
    act(() => input.focus());
    fireEvent.mouseMove(beta);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(select).toHaveBeenCalledWith("Beta");
  });
});
