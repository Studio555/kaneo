import type { GitHubConfig } from "../config";

/**
 * Reads an integration's stored config, or returns null and logs when it is
 * not valid JSON, so one broken row cannot stop a webhook from reaching the
 * other integrations.
 */
export function parseIntegrationConfig(integration: {
  id: string;
  config: string;
}): GitHubConfig | null {
  try {
    return JSON.parse(integration.config) as GitHubConfig;
  } catch (error) {
    console.error(
      `[GitHub Webhook] Skipping integration ${integration.id}: unreadable config`,
      error,
    );
    return null;
  }
}
