import type { ReactNode } from "react";

export type OptionMenuItem = {
  value: string;
  label: string;
  /** Extra text the search matches, such as a person's email. */
  keywords?: string;
  icon?: ReactNode;
  selected?: boolean;
  hint?: string;
  pinned?: boolean;
};
