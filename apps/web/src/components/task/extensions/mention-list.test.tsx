import { act, cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import MentionList, { type MentionListRef } from "./mention-list";

afterEach(cleanup);
describe("mention suggestions", () => {
  it.each(["j", "n", "k", "p"])(
    "moves the highlight with Ctrl+%s and inserts it with Enter",
    (key) => {
      const ref = createRef<MentionListRef>();
      const command = vi.fn();
      const items = [
        { id: "alice", label: "Alice" },
        { id: "bob", label: "Bob" },
        { id: "carol", label: "Carol" },
      ];
      const { container } = render(
        <MentionList ref={ref} items={items} command={command} />,
      );
      act(() => {
        expect(
          ref.current?.onKeyDown({
            event: new KeyboardEvent("keydown", { key, ctrlKey: true }),
          }),
        ).toBe(true);
      });
      const selected = key === "j" || key === "n" ? items[1] : items[2];
      expect(container.querySelector(".is-active")).toHaveTextContent(
        selected.label,
      );
      act(() => {
        ref.current?.onKeyDown({
          event: new KeyboardEvent("keydown", { key: "Enter" }),
        });
      });
      expect(command).toHaveBeenCalledWith(selected);
    },
  );
  it("does not handle plain letters or composing input", () => {
    const ref = createRef<MentionListRef>();
    render(
      <MentionList
        ref={ref}
        items={[{ id: "alice", label: "Alice" }]}
        command={vi.fn()}
      />,
    );
    expect(
      ref.current?.onKeyDown({
        event: new KeyboardEvent("keydown", { key: "j" }),
      }),
    ).toBe(false);
    expect(
      ref.current?.onKeyDown({
        event: new KeyboardEvent("keydown", {
          key: "Enter",
          isComposing: true,
        }),
      }),
    ).toBe(false);
  });
});
