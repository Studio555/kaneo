import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import {
  getNextSuggestionIndex,
  handleSuggestionNavigation,
} from "@/lib/suggestion-navigation";

type SuggestionNavigationOptions = {
  items: readonly string[];
  query: string;
  enabled?: boolean;
};

export function useSuggestionNavigation({
  items,
  query,
  enabled = true,
}: SuggestionNavigationOptions) {
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [selection, setSelection] = useState<{
    item: string;
    query: string;
  } | null>(null);
  const activeIndex =
    enabled && focused && selection?.query === query
      ? items.indexOf(selection.item)
      : -1;
  const optionId = (index: number) => `${listId}-option-${index}`;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (
      !enabled ||
      event.defaultPrevented ||
      event.nativeEvent.isComposing ||
      event.currentTarget !== document.activeElement
    ) {
      return;
    }
    const navigated = handleSuggestionNavigation(
      event.nativeEvent,
      items.length,
      (direction) => {
        const nextIndex = getNextSuggestionIndex(
          activeIndex,
          items.length,
          direction,
        );
        setSelection({ item: items[nextIndex], query });
        document
          .getElementById(optionId(nextIndex))
          ?.scrollIntoView?.({ block: "nearest" });
      },
    );
    if (navigated) {
      event.preventDefault();
      event.stopPropagation();
    } else if (
      event.key === "Enter" &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.shiftKey
    ) {
      // Enter inside a picker must not submit its surrounding form.
      event.preventDefault();
      event.stopPropagation();
      if (activeIndex >= 0) {
        document.getElementById(optionId(activeIndex))?.click();
      }
    }
  };

  return {
    inputProps: {
      role: "combobox" as const,
      "aria-autocomplete": "list" as const,
      "aria-expanded": enabled,
      "aria-controls": enabled ? listId : undefined,
      "aria-activedescendant":
        activeIndex >= 0 ? optionId(activeIndex) : undefined,
      onKeyDown,
      onFocus: () => {
        setFocused(true);
        setSelection(null);
      },
      onBlur: () => {
        setFocused(false);
        setSelection(null);
      },
      onInput: () => setSelection(null),
    },
    listProps: { id: listId, role: "listbox" as const },
    getOptionProps: (index: number) => ({
      id: optionId(index),
      role: "option" as const,
      "aria-selected": activeIndex === index,
      "data-suggestion-highlighted": activeIndex === index ? "true" : undefined,
      onMouseMove: () => {
        if (enabled && focused && activeIndex !== index) {
          setSelection({ item: items[index], query });
        }
      },
    }),
  };
}

export function useSuggestionScroll(
  activeIndex: number | undefined,
  enabled: boolean,
  highlightedSelector: string,
) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!enabled || activeIndex === undefined || activeIndex < 0) return;
    listRef.current
      ?.querySelector<HTMLElement>(highlightedSelector)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, enabled, highlightedSelector]);
  return listRef;
}
