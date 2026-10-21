import * as v from "valibot";

export const DEFAULT_SLACK_APP_EMOJI = "kaneo";

export const slackAppConfigSchema = v.object({
  emoji: v.optional(v.string()),
  /** Reacting with this starts an agent fix; unset leaves the feature off. */
  agentEmoji: v.optional(v.string()),
  /** Slack user told when the agent runner needs a person, e.g. to sign in again. */
  maintainerSlackUserId: v.optional(v.string()),
});

export type SlackAppConfig = v.InferOutput<typeof slackAppConfigSchema>;

/**
 * Slack reports reactions by bare name, so the colons people paste along with
 * an emoji have to come off before the comparison.
 */
function normalizeEmoji(emoji: string | undefined): string | undefined {
  return emoji?.trim().replace(/^:|:$/g, "").toLowerCase() || undefined;
}

export function normalizeSlackAppConfig(
  config: SlackAppConfig,
): SlackAppConfig {
  return {
    ...config,
    emoji: normalizeEmoji(config.emoji) || DEFAULT_SLACK_APP_EMOJI,
    agentEmoji: normalizeEmoji(config.agentEmoji),
    maintainerSlackUserId: config.maintainerSlackUserId?.trim() || undefined,
  };
}

export async function validateSlackAppConfig(
  config: unknown,
): Promise<{ valid: boolean; errors?: string[] }> {
  try {
    const parsed = normalizeSlackAppConfig(
      v.parse(slackAppConfigSchema, config),
    );

    // One reaction cannot mean both "file this" and "fix this".
    if (parsed.agentEmoji && parsed.agentEmoji === parsed.emoji) {
      return {
        valid: false,
        errors: ["agentEmoji must differ from emoji"],
      };
    }

    return { valid: true };
  } catch (error) {
    if (error instanceof v.ValiError) {
      return {
        valid: false,
        errors: error.issues.map((issue) => issue.message),
      };
    }

    return {
      valid: false,
      errors: [error instanceof Error ? error.message : "Invalid config"],
    };
  }
}
