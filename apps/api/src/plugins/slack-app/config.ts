import * as v from "valibot";

export const DEFAULT_SLACK_APP_EMOJI = "kaneo";

export const slackAppConfigSchema = v.object({
  emoji: v.optional(v.string()),
});

export type SlackAppConfig = v.InferOutput<typeof slackAppConfigSchema>;

/**
 * Slack reports reactions by bare name, so the colons people paste along with
 * an emoji have to come off before the comparison.
 */
export function normalizeSlackAppConfig(
  config: SlackAppConfig,
): SlackAppConfig {
  const emoji = config.emoji?.trim().replace(/^:|:$/g, "").toLowerCase();

  return {
    ...config,
    emoji: emoji || DEFAULT_SLACK_APP_EMOJI,
  };
}

export async function validateSlackAppConfig(
  config: unknown,
): Promise<{ valid: boolean; errors?: string[] }> {
  try {
    v.parse(slackAppConfigSchema, config);
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
