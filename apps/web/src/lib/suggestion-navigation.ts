import type { KeyboardEvent as ReactKeyboardEvent } from "react";

type NavigationKeyEvent = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "altKey" | "metaKey" | "shiftKey" | "isComposing"
>;

export function getSuggestionNavigationDirection(event: NavigationKeyEvent) {
  if (event.isComposing || event.altKey || event.metaKey || event.shiftKey) {
    return null;
  }
  if (!event.ctrlKey) {
    if (event.key === "ArrowDown") return 1;
    if (event.key === "ArrowUp") return -1;
    return null;
  }
  const key = event.key.toLowerCase();
  if (key === "j" || key === "n") return 1;
  if (key === "k" || key === "p") return -1;
  return null;
}

export function getNextSuggestionIndex(
  currentIndex: number,
  itemCount: number,
  direction: 1 | -1,
) {
  if (itemCount <= 0) return -1;
  if (currentIndex < 0 || currentIndex >= itemCount) {
    return direction === 1 ? 0 : itemCount - 1;
  }
  return (currentIndex + direction + itemCount) % itemCount;
}

export function moveSuggestionHighlight<T extends { selectedIndex?: number }>(
  current: T | null,
  itemCount: number,
  direction: 1 | -1,
): T | null {
  if (!current || itemCount <= 0) return current;
  return {
    ...current,
    selectedIndex: getNextSuggestionIndex(
      current.selectedIndex ?? 0,
      itemCount,
      direction,
    ),
  };
}

export function handleSuggestionNavigation(
  event: KeyboardEvent,
  itemCount: number,
  navigate: (direction: 1 | -1) => void,
) {
  if (event.defaultPrevented || itemCount <= 0) return false;
  const direction = getSuggestionNavigationDirection(event);
  if (direction === null) return false;
  event.preventDefault();
  event.stopPropagation();
  navigate(direction);
  return true;
}

// Let Base UI handle highlighting, scrolling, and selection for its own inputs.
export function handleSuggestionNavigationShortcut(
  event: ReactKeyboardEvent<HTMLInputElement>,
) {
  if (
    event.defaultPrevented ||
    !event.ctrlKey ||
    event.currentTarget !== document.activeElement
  ) {
    return;
  }
  const direction = getSuggestionNavigationDirection(event.nativeEvent);
  if (direction === null) return;
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: direction === 1 ? "ArrowDown" : "ArrowUp",
      bubbles: true,
      cancelable: true,
    }),
  );
}
