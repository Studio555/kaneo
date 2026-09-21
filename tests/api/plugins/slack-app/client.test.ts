import { afterEach, describe, expect, it, vi } from "vitest";
import { createSlackClient } from "../../../../apps/api/src/plugins/slack-app/client";

type FetchCall = { url: string; init: RequestInit };

function stubSlack(responses: Record<string, unknown>) {
  const calls: FetchCall[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const method = new URL(url).pathname.split("/").pop() ?? "";
      return {
        ok: true,
        status: 200,
        json: async () => responses[method] ?? { ok: false, error: "unmocked" },
      } as unknown as Response;
    }),
  );

  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createSlackClient", () => {
  it("authenticates with the bot token", async () => {
    const calls = stubSlack({
      "chat.postMessage": { ok: true },
    });

    await createSlackClient("xoxb-test-token").postThreadReply({
      channel: "C1",
      threadTs: "1700000000.000100",
      text: "hello",
    });

    expect(calls[0]?.init.headers).toMatchObject({
      Authorization: "Bearer xoxb-test-token",
    });
  });

  it("posts a reply into the thread it was given", async () => {
    const calls = stubSlack({ "chat.postMessage": { ok: true } });

    await createSlackClient("xoxb").postThreadReply({
      channel: "C1",
      threadTs: "1700000000.000100",
      text: "Created PS-7",
    });

    expect(calls[0]?.url).toContain("chat.postMessage");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      channel: "C1",
      thread_ts: "1700000000.000100",
      text: "Created PS-7",
    });
  });

  it("throws when Slack reports a failure in an HTTP 200 body", async () => {
    stubSlack({ "chat.postMessage": { ok: false, error: "not_in_channel" } });

    await expect(
      createSlackClient("xoxb").postThreadReply({
        channel: "C1",
        threadTs: "1",
        text: "hello",
      }),
    ).rejects.toThrow("not_in_channel");
  });

  it("reads the message text, author and thread from conversations.replies", async () => {
    stubSlack({
      "conversations.replies": {
        ok: true,
        messages: [
          {
            text: "The build is broken",
            user: "U123",
            ts: "1700000000.000100",
            thread_ts: "1699999999.000100",
          },
        ],
      },
    });

    await expect(
      createSlackClient("xoxb").getMessage({
        channel: "C1",
        ts: "1700000000.000100",
      }),
    ).resolves.toEqual({
      text: "The build is broken",
      userId: "U123",
      threadTs: "1699999999.000100",
    });
  });

  it("returns the reacted reply rather than the thread's parent message", async () => {
    stubSlack({
      "conversations.replies": {
        ok: true,
        messages: [
          {
            text: "Starting the release",
            user: "UPARENT",
            ts: "1699999999.000100",
          },
          {
            text: "The build is broken",
            user: "UREPLY",
            ts: "1700000000.000100",
            thread_ts: "1699999999.000100",
          },
        ],
      },
    });

    await expect(
      createSlackClient("xoxb").getMessage({
        channel: "C1",
        ts: "1700000000.000100",
      }),
    ).resolves.toEqual({
      text: "The build is broken",
      userId: "UREPLY",
      threadTs: "1699999999.000100",
    });
  });

  it("returns null when the reacted timestamp is absent from the thread", async () => {
    stubSlack({
      "conversations.replies": {
        ok: true,
        messages: [
          { text: "Starting the release", user: "U1", ts: "1699999999.000100" },
        ],
      },
    });

    await expect(
      createSlackClient("xoxb").getMessage({
        channel: "C1",
        ts: "1700000000.000100",
      }),
    ).resolves.toBeNull();
  });

  it("falls back to the message's own ts when it is not in a thread", async () => {
    stubSlack({
      "conversations.replies": {
        ok: true,
        messages: [{ text: "hi", user: "U1", ts: "1700000000.000100" }],
      },
    });

    const message = await createSlackClient("xoxb").getMessage({
      channel: "C1",
      ts: "1700000000.000100",
    });

    expect(message?.threadTs).toBe("1700000000.000100");
  });

  it("returns null when the message no longer exists", async () => {
    stubSlack({ "conversations.replies": { ok: true, messages: [] } });

    await expect(
      createSlackClient("xoxb").getMessage({ channel: "C1", ts: "1" }),
    ).resolves.toBeNull();
  });

  it("returns the reacting user's email address", async () => {
    stubSlack({
      "users.info": {
        ok: true,
        user: { profile: { email: "alex@studio555.io" } },
      },
    });

    await expect(createSlackClient("xoxb").getUserEmail("U123")).resolves.toBe(
      "alex@studio555.io",
    );
  });

  it("returns null when the user has no visible email", async () => {
    stubSlack({ "users.info": { ok: true, user: { profile: {} } } });

    await expect(createSlackClient("xoxb").getUserEmail("U123")).resolves.toBe(
      null,
    );
  });
});
