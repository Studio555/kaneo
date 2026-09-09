import * as Sentry from "@sentry/node";
import { config } from "dotenv-mono";
import { App } from "octokit";

config();

let githubAppInstance: App | null = null;

// Resolve the GitHub App private key from env in whichever form the host
// can carry. Orchestrators like Portainer's form-based stack editor strip
// real newlines from env values, so users end up with either an empty key
// or a single line containing literal "\n" sequences. Support three shapes:
//
//   1. GITHUB_PRIVATE_KEY = real multi-line PEM (the canonical form)
//   2. GITHUB_PRIVATE_KEY = single line with literal `\n` separators
//   3. GITHUB_PRIVATE_KEY_BASE64 = base64-encoded PEM (no newline issues)
//
// Returns "" when nothing is set; the caller's existence check handles that.
export function resolveGithubPrivateKey(): string {
  const base64 = process.env.GITHUB_PRIVATE_KEY_BASE64;
  if (base64 && base64.trim() !== "") {
    return Buffer.from(base64.trim(), "base64").toString("utf8");
  }
  const raw = process.env.GITHUB_PRIVATE_KEY ?? "";
  if (raw.includes("\\n") && !raw.includes("\n")) {
    return raw.replace(/\\n/g, "\n");
  }
  return raw;
}

export function getGithubApp(): App | null {
  if (githubAppInstance) {
    return githubAppInstance;
  }

  const privateKey = resolveGithubPrivateKey();
  if (
    !process.env.GITHUB_WEBHOOK_SECRET ||
    !process.env.GITHUB_APP_ID ||
    !privateKey
  ) {
    return null;
  }

  githubAppInstance = new App({
    appId: process.env.GITHUB_APP_ID ?? "",
    privateKey,
    webhooks: {
      secret: process.env.GITHUB_WEBHOOK_SECRET ?? "",
    },
  });

  return githubAppInstance;
}

export async function getInstallationOctokit(installationId: number) {
  const app = getGithubApp();
  if (!app) {
    throw new Error("GitHub App not configured");
  }
  Sentry.addBreadcrumb({
    category: "integration",
    level: "info",
    data: { integration: "github", op: "installationOctokit" },
  });
  return app.getInstallationOctokit(installationId);
}

/**
 * An Octokit authenticated as one of the App's installations, for calls that
 * are not app-level.
 *
 * `app.octokit` is only good for `/app*` routes: @octokit/auth-app picks
 * installation authentication for every other route and throws
 * "installationId option is required" before the request is ever sent. Any
 * installation's token can read a public endpoint such as a user lookup, so
 * the first one will do.
 *
 * Returns null when the App is installed nowhere, or when GitHub cannot be
 * reached to ask.
 */
export async function getAnyInstallationOctokit(app: App) {
  Sentry.addBreadcrumb({
    category: "integration",
    level: "info",
    data: { integration: "github", op: "anyInstallationOctokit" },
  });

  try {
    const { data: installations } =
      await app.octokit.rest.apps.listInstallations();
    const installation = installations[0];

    if (!installation) {
      return null;
    }

    return await app.getInstallationOctokit(installation.id);
  } catch (error) {
    console.error("Failed to obtain a GitHub installation client:", error);
    return null;
  }
}

export async function getInstallationIdForRepo(
  owner: string,
  repo: string,
): Promise<number> {
  const app = getGithubApp();
  if (!app) {
    throw new Error("GitHub App not configured");
  }

  Sentry.addBreadcrumb({
    category: "integration",
    level: "info",
    data: {
      integration: "github",
      op: "getInstallationIdForRepo",
    },
  });

  const { data: installation } =
    await app.octokit.rest.apps.getRepoInstallation({
      owner,
      repo,
    });

  return installation.id;
}
