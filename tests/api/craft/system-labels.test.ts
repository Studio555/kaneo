import { describe, expect, it } from "vite-plus/test";
import {
  FALLBACK_LABEL_HEX,
  toHexColor,
} from "../../../apps/api/src/plugins/label-color";
import {
  isSystemLabelName,
  parseCraftLabelName,
  SYSTEM_LABEL_PREFIXES,
  toCraftLabelName,
} from "../../../apps/api/src/plugins/system-labels";

describe("isSystemLabelName", () => {
  it("treats the priority and status prefixes as system labels", () => {
    expect(isSystemLabelName("priority:high")).toBe(true);
    expect(isSystemLabelName("status:in-progress")).toBe(true);
  });

  it("treats the craft prefix as a system label", () => {
    // This is what keeps `craft:` labels out of the Kaneo label vocabulary;
    // without it the pollution craft exists to avoid simply moves prefix.
    expect(isSystemLabelName("craft:Engineering")).toBe(true);
  });

  it("leaves ordinary labels alone", () => {
    expect(isSystemLabelName("bug")).toBe(false);
    expect(isSystemLabelName("good first issue")).toBe(false);
    expect(isSystemLabelName("crafty")).toBe(false);
    expect(isSystemLabelName("area:client")).toBe(false);
  });

  it("covers every declared prefix", () => {
    for (const prefix of SYSTEM_LABEL_PREFIXES) {
      expect(isSystemLabelName(`${prefix}anything`)).toBe(true);
    }
  });
});

describe("parseCraftLabelName", () => {
  it("extracts the craft name", () => {
    expect(parseCraftLabelName("craft:Engineering")).toBe("Engineering");
  });

  it("trims surrounding whitespace", () => {
    expect(parseCraftLabelName("craft: Art Direction ")).toBe("Art Direction");
  });

  it("returns null for a label that is not a craft label", () => {
    expect(parseCraftLabelName("priority:high")).toBeNull();
    expect(parseCraftLabelName("bug")).toBeNull();
  });

  it("returns null when the name is empty after the prefix", () => {
    expect(parseCraftLabelName("craft:")).toBeNull();
    expect(parseCraftLabelName("craft:   ")).toBeNull();
  });
});

describe("toCraftLabelName", () => {
  it("round-trips with parseCraftLabelName", () => {
    expect(parseCraftLabelName(toCraftLabelName("Audio"))).toBe("Audio");
  });
});

describe("toHexColor", () => {
  it("maps the palette keys the craft UI stores to forge hex", () => {
    // The settings page stores `labelColors[].value` ("gray", "purple"), and
    // GitHub/Gitea reject anything but a bare six-digit hex.
    expect(toHexColor("gray")).toBe("6B7280");
    expect(toHexColor("purple")).toBe("A855F7");
    expect(toHexColor("teal")).toBe("14B8A6");
  });

  it("accepts hex with or without a leading hash", () => {
    expect(toHexColor("#3B82F6")).toBe("3b82f6");
    expect(toHexColor("3b82f6")).toBe("3b82f6");
  });

  it("expands three-digit hex", () => {
    expect(toHexColor("#abc")).toBe("aabbcc");
  });

  it("falls back for a value no forge would accept", () => {
    expect(toHexColor("dark-gray")).toBe(FALLBACK_LABEL_HEX);
    expect(toHexColor("var(--color-stone-500)")).toBe(FALLBACK_LABEL_HEX);
  });
});
