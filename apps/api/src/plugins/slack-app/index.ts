import type { IntegrationPlugin } from "../types";
import { createSlackClient } from "./client";
import { validateSlackAppConfig } from "./config";
import { handleTaskStatusChanged } from "./events";
import {
  handleSlackEventsRequest,
  type SlackEventsRequest,
  type SlackEventsResult,
} from "./events-request";
import { handleReactionAdded } from "./reaction-added";

export const slackAppPlugin: IntegrationPlugin = {
  type: "slack-app",
  name: "Slack App",
  onTaskStatusChanged: handleTaskStatusChanged,
  validateConfig: validateSlackAppConfig,
};

/**
 * The bot token and signing secret belong to the Slack app, not to any one
 * project, so they come from the environment while the project-scoped settings
 * live on the integration row.
 */
export async function handleSlackEvent(
  request: SlackEventsRequest,
): Promise<SlackEventsResult> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  const signingSecret = process.env.SLACK_SIGNING_SECRET;

  if (!botToken || !signingSecret) {
    console.error(
      "[Slack App] SLACK_BOT_TOKEN or SLACK_SIGNING_SECRET is unset",
    );
    return { status: 503, body: "slack app not configured" };
  }

  const client = createSlackClient(botToken);

  return handleSlackEventsRequest(request, {
    signingSecret,
    dispatch: (event) => handleReactionAdded(event, { client }),
  });
}

export { SLACK_MESSAGE_RESOURCE_TYPE } from "./reaction-added";
