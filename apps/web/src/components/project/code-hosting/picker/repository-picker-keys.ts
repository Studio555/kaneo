import type { KeyboardEvent } from "react";
import {
  getNextSuggestionIndex,
  handleSuggestionNavigation,
} from "@/lib/suggestion-navigation";

// Arrow keys (and ctrl+j/k/n/p) move the selection from the search field;
// Enter uses the selected repository.
export function repositoryPickerKeyDown<Item>(
  items: Item[],
  selectedIndex: number,
  onSelect: (item: Item) => void,
  onConfirm: () => void,
) {
  return (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    const moved = handleSuggestionNavigation(
      event.nativeEvent,
      items.length,
      (direction) =>
        onSelect(
          items[getNextSuggestionIndex(selectedIndex, items.length, direction)],
        ),
    );
    if (moved) return;
    if (
      event.key === "Enter" &&
      selectedIndex >= 0 &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.shiftKey
    ) {
      event.preventDefault();
      onConfirm();
    }
  };
}
