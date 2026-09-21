import { describe, expect, it } from "vitest";
import {
  DEFAULT_SLACK_APP_EMOJI,
  normalizeSlackAppConfig,
  validateSlackAppConfig,
} from "../../../../apps/api/src/plugins/slack-app/config";

describe("normalizeSlackAppConfig", () => {
  it("falls back to the default emoji when none is configured", () => {
    expect(normalizeSlackAppConfig({}).emoji).toBe(DEFAULT_SLACK_APP_EMOJI);
  });

  it("strips the colons people copy along with an emoji name", () => {
    expect(normalizeSlackAppConfig({ emoji: ":kaneo:" }).emoji).toBe("kaneo");
  });

  it("lowercases the emoji so it matches Slack's own casing", () => {
    expect(normalizeSlackAppConfig({ emoji: "Kaneo" }).emoji).toBe("kaneo");
  });

  it("treats a blank emoji as unset rather than matching everything", () => {
    expect(normalizeSlackAppConfig({ emoji: "   " }).emoji).toBe(
      DEFAULT_SLACK_APP_EMOJI,
    );
  });
});

describe("validateSlackAppConfig", () => {
  it("accepts an empty config", async () => {
    await expect(validateSlackAppConfig({})).resolves.toEqual({ valid: true });
  });

  it("accepts a configured emoji", async () => {
    await expect(validateSlackAppConfig({ emoji: "ticket" })).resolves.toEqual({
      valid: true,
    });
  });

  it("rejects an emoji that is not a string", async () => {
    const result = await validateSlackAppConfig({ emoji: 42 });
    expect(result.valid).toBe(false);
    expect(result.errors?.length).toBeGreaterThan(0);
  });
});
