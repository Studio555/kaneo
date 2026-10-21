// Prefixes that mark a forge label as carrying a Kaneo field rather than being
// a label in its own right. Every place that decides whether an inbound label
// becomes a Kaneo label has to consult this list, or a new prefix silently
// starts polluting the label vocabulary the way `status:`/`priority:` once did.
export const SYSTEM_LABEL_PREFIXES = [
  "priority:",
  "status:",
  "craft:",
] as const;

export const CRAFT_LABEL_PREFIX = "craft:";

export function isSystemLabelName(name: string) {
  return SYSTEM_LABEL_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/** `craft:Engineering` -> `Engineering`; anything else -> null. */
export function parseCraftLabelName(name: string): string | null {
  if (!name.startsWith(CRAFT_LABEL_PREFIX)) return null;
  const craftName = name.slice(CRAFT_LABEL_PREFIX.length).trim();
  return craftName.length > 0 ? craftName : null;
}

export function toCraftLabelName(craftName: string) {
  return `${CRAFT_LABEL_PREFIX}${craftName}`;
}
