import { describe, expect, it, vi } from "vite-plus/test";
import {
  getNextSuggestionIndex,
  handleSuggestionNavigation,
  moveSuggestionHighlight,
} from "./suggestion-navigation";

describe("shared suggestion navigation", () => {
  it.each([
    [-1, 3, 1, 0],
    [-1, 3, -1, 2],
    [0, 3, -1, 2],
    [2, 3, 1, 0],
    [4, 3, 1, 0],
    [4, 3, -1, 2],
    [0, 0, 1, -1],
  ] as const)(
    "moves from %i among %i items in direction %i to %i",
    (index, count, direction, expected) => {
      expect(getNextSuggestionIndex(index, count, direction)).toBe(expected);
    },
  );

  it("moves menu highlights while preserving query and selection context", () => {
    const menu = { selectedIndex: 0, query: "heading", from: 3, to: 10 };
    expect(moveSuggestionHighlight(menu, 3, -1)).toEqual({
      ...menu,
      selectedIndex: 2,
    });
    expect(moveSuggestionHighlight(menu, 0, 1)).toBe(menu);
    expect(moveSuggestionHighlight(null, 3, 1)).toBeNull();
    expect(
      moveSuggestionHighlight({ url: "video", selectedIndex: undefined }, 2, 1),
    ).toEqual({ url: "video", selectedIndex: 1 });
  });

  it("leaves empty menus and already handled events alone", () => {
    const move = vi.fn();
    const empty = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      cancelable: true,
    });
    expect(handleSuggestionNavigation(empty, 0, move)).toBe(false);
    expect(empty.defaultPrevented).toBe(false);
    const handled = new KeyboardEvent("keydown", {
      key: "n",
      ctrlKey: true,
      cancelable: true,
    });
    handled.preventDefault();
    expect(handleSuggestionNavigation(handled, 3, move)).toBe(false);
    expect(move).not.toHaveBeenCalled();
  });

  it("consumes navigation once so it cannot also invoke a global shortcut", () => {
    const event = new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      cancelable: true,
    });
    const move = vi.fn();
    expect(handleSuggestionNavigation(event, 3, move)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(move).toHaveBeenCalledExactlyOnceWith(-1);
    expect(handleSuggestionNavigation(event, 3, move)).toBe(false);
  });
});
