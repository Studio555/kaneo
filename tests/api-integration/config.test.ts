import { describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/index";

describe("API integration: config", () => {
  it("returns the public config shape", async () => {
    const { app } = createApp();

    const response = await app.request("/api/config");

    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;

    expect(payload).toMatchObject({
      disableRegistration: false,
      disablePasswordRegistration: false,
      disableEmailOtpSignIn: false,
      disableLoginForm: false,
      customOAuthAutoLogin: false,
      isDemoMode: false,
      hasGuestAccess: true,
      datesEnabled: true,
    });
    expect(payload).toSatisfy((value: Record<string, unknown>) =>
      [
        "hasSmtp",
        "hasGithubSignIn",
        "hasGoogleSignIn",
        "hasDiscordSignIn",
        "hasCustomOAuth",
      ].every((key) => typeof value[key] === "boolean"),
    );
  });

  it("reports dates as disabled when DISABLE_DATES is set", async () => {
    const original = process.env.DISABLE_DATES;
    process.env.DISABLE_DATES = "true";
    try {
      const { app } = createApp();
      const response = await app.request("/api/config");
      const payload = (await response.json()) as Record<string, unknown>;
      expect(payload.datesEnabled).toBe(false);
    } finally {
      if (original === undefined) {
        delete process.env.DISABLE_DATES;
      } else {
        process.env.DISABLE_DATES = original;
      }
    }
  });
});
