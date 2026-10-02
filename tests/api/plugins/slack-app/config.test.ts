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

describe("normalizeSlackAppConfig agent settings", () => {
  it("leaves the agent reaction off when no agent emoji is configured", () => {
    expect(normalizeSlackAppConfig({}).agentEmoji).toBeUndefined();
  });

  it("treats a blank agent emoji as off rather than matching everything", () => {
    expect(normalizeSlackAppConfig({ agentEmoji: "  " }).agentEmoji).toBe(
      undefined,
    );
  });

  it("normalizes the agent emoji like the filing emoji", () => {
    expect(
      normalizeSlackAppConfig({ agentEmoji: ":Robot_Fix:" }).agentEmoji,
    ).toBe("robot_fix");
  });

  it("trims the maintainer and drops a blank one", () => {
    expect(
      normalizeSlackAppConfig({ maintainerSlackUserId: " U0AKCQBB1B3 " })
        .maintainerSlackUserId,
    ).toBe("U0AKCQBB1B3");
    expect(
      normalizeSlackAppConfig({ maintainerSlackUserId: " " })
        .maintainerSlackUserId,
    ).toBeUndefined();
  });
});

describe("validateSlackAppConfig", () => {
  it("accepts agent settings", async () => {
    await expect(
      validateSlackAppConfig({
        agentEmoji: "robot_fix",
        maintainerSlackUserId: "U0AKCQBB1B3",
      }),
    ).resolves.toEqual({ valid: true });
  });

  it("rejects an agent emoji that is the filing emoji", async () => {
    const result = await validateSlackAppConfig({
      emoji: "kaneo",
      agentEmoji: ":kaneo:",
    });
    expect(result.valid).toBe(false);
  });

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
