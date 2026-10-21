import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import type {
  SlackClient,
  SlackThreadMessage,
} from "../../../../apps/api/src/plugins/slack-app/client";
import {
  assembleDescription,
  capThread,
  enrichTask,
  pickImageCandidates,
  startTaskEnrichment,
} from "../../../../apps/api/src/plugins/slack-app/enrich-task";

const mocks = vi.hoisted(() => ({
  recentTasks: vi.fn(),
  taskFindFirst: vi.fn(),
  updateTaskTitle: vi.fn(),
  updateTaskDescription: vi.fn(),
  createComment: vi.fn(),
}));

vi.mock("../../../../apps/api/src/database", () => ({
  default: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: async () => mocks.recentTasks() }),
        }),
      }),
    }),
    query: { taskTable: { findFirst: mocks.taskFindFirst } },
  },
}));

vi.mock("../../../../apps/api/src/task/controllers/update-task-title", () => ({
  default: (...args: unknown[]) => mocks.updateTaskTitle(...args),
}));

vi.mock(
  "../../../../apps/api/src/task/controllers/update-task-description",
  () => ({
    default: (...args: unknown[]) => mocks.updateTaskDescription(...args),
  }),
);

vi.mock("../../../../apps/api/src/activity/controllers/create-comment", () => ({
  default: (...args: unknown[]) => mocks.createComment(...args),
}));

const ROOT = "1700000000.000100";
const REPLY = "1700000100.000100";

const original = {
  title: "The checkout screen crashes",
  description: "> The checkout screen crashes\n\nFiled from Slack.",
};

const request = {
  taskId: "task-1",
  projectId: "proj-1",
  prefix: "PS",
  taskNumber: 7,
  url: "https://kaneo.test/task/task-1",
  original,
  channel: "C1",
  threadTs: ROOT,
  reactedTs: ROOT,
  actorId: "user-1",
};

function message(
  ts: string,
  overrides: Partial<SlackThreadMessage> = {},
): SlackThreadMessage {
  return {
    ts,
    userId: "UAUTHOR",
    text: `message ${ts}`,
    files: [],
    ...overrides,
  };
}

function image(name: string, size = 1000, mimetype = "image/png") {
  return { name, mimetype, size, url: `https://files.slack.com/${name}` };
}

function slackClient(thread: SlackThreadMessage[]) {
  return {
    getThread: vi.fn(async () => thread),
    downloadImage: vi.fn(async () => Buffer.from("png-bytes")),
    getUserName: vi.fn(async () => "Alex"),
    postThreadReply: vi.fn(async () => undefined),
  } as unknown as SlackClient & {
    getThread: ReturnType<typeof vi.fn>;
    downloadImage: ReturnType<typeof vi.fn>;
    getUserName: ReturnType<typeof vi.fn>;
    postThreadReply: ReturnType<typeof vi.fn>;
  };
}

const goodOutput = {
  title: "Checkout screen crashes on pay tap",
  description: {
    summary: "The app crashes on checkout.",
    observed: "The screenshot shows a frozen checkout screen.",
    where: "Checkout",
    repro: "",
    openQuestions: ["Which build?"],
  },
  possibleDuplicateOf: null as number | null,
};

function openAiResponse(output: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text:
                typeof output === "string" ? output : JSON.stringify(output),
            },
          ],
        },
      ],
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        input_tokens_details: { cached_tokens: 10 },
      },
    }),
  } as unknown as Response;
}

function stubOpenAi(...outputs: unknown[]) {
  const fetchMock = vi.fn();
  for (const output of outputs) {
    fetchMock.mockResolvedValueOnce(openAiResponse(output));
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  const init = fetchMock.mock.calls[call]?.[1] as RequestInit;
  return JSON.parse(String(init.body));
}

const deps = (client: SlackClient) => ({
  client,
  apiKey: "sk-test",
  model: "gpt-test",
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY_FILE", "");
  vi.stubEnv("SLACK_TRIAGE_MODEL", "");
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.recentTasks.mockResolvedValue([
    { number: 3, title: "Checkout freezes" },
    { number: 5, title: "Sofa clips through wall" },
  ]);
  mocks.taskFindFirst.mockResolvedValue({ id: "task-1", ...original });
  mocks.updateTaskTitle.mockResolvedValue({});
  mocks.updateTaskDescription.mockResolvedValue({});
  mocks.createComment.mockResolvedValue({});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("capThread", () => {
  it("keeps the root, the reacted message and the newest others", () => {
    const messages = Array.from({ length: 250 }, (_, i) =>
      message(String(1000 + i)),
    );

    const { kept, omitted } = capThread(messages, {
      rootTs: "1000",
      reactedTs: "1010",
    });

    expect(kept).toHaveLength(200);
    expect(omitted).toBe(50);
    expect(kept[0]?.ts).toBe("1000");
    expect(kept[1]?.ts).toBe("1010");
    expect(kept[2]?.ts).toBe("1052");
    expect(kept.at(-1)?.ts).toBe("1249");
  });

  it("leaves a short thread alone", () => {
    const messages = [message(ROOT), message(REPLY)];

    expect(capThread(messages, { rootTs: ROOT, reactedTs: REPLY })).toEqual({
      kept: messages,
      omitted: 0,
    });
  });
});

describe("pickImageCandidates", () => {
  it("orders the reacted message, then the root, then newest replies", () => {
    const messages = [
      message("1", { files: [image("root.png")] }),
      message("2", { files: [image("old.png")] }),
      message("3", { files: [image("reacted.png")] }),
      message("4", { files: [image("new.png")] }),
    ];

    const names = pickImageCandidates(messages, {
      rootTs: "1",
      reactedTs: "3",
    }).map((file) => file.name);

    expect(names).toEqual(["reacted.png", "root.png", "new.png", "old.png"]);
  });

  it("drops non-images and images over 5 MB", () => {
    const messages = [
      message("1", {
        files: [
          image("log.txt", 100, "text/plain"),
          image("huge.png", 5 * 1024 * 1024 + 1),
          image("ok.jpg", 100, "image/jpeg"),
        ],
      }),
    ];

    expect(
      pickImageCandidates(messages, { rootTs: "1", reactedTs: "1" }).map(
        (file) => file.name,
      ),
    ).toEqual(["ok.jpg"]);
  });
});

describe("assembleDescription", () => {
  it("omits empty repro and open questions and keeps the original below", () => {
    const text = assembleDescription(
      { ...goodOutput.description, openQuestions: [] },
      original.description,
    );

    expect(text).not.toContain("**Repro**");
    expect(text).not.toContain("**Open questions**");
    expect(text).toBe(
      [
        "**Summary**\nThe app crashes on checkout.",
        "**Observed**\nThe screenshot shows a frozen checkout screen.",
        "**Where**\nCheckout",
        "---",
        original.description,
        "_Triaged by Kaneo — edit freely._",
      ].join("\n\n"),
    );
  });
});

describe("enrichTask", () => {
  it("sends one Responses request with the model, schema, store false and images", async () => {
    const thread = [
      message(ROOT, {
        files: [image("shot.png"), image("notes.pdf", 10, "application/pdf")],
      }),
      message(REPLY, { userId: "UOTHER" }),
    ];
    const client = slackClient(thread);
    const fetchMock = stubOpenAi(goodOutput);

    await enrichTask(request, deps(client));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.openai.com/v1/responses",
    );
    const body = requestBody(fetchMock);
    expect(body.model).toBe("gpt-test");
    expect(body.store).toBe(false);
    expect(body.instructions).toContain("Never invent reproduction steps");
    expect(body.text.format).toMatchObject({
      type: "json_schema",
      strict: true,
    });
    expect(body.text.format.schema.required).toEqual([
      "title",
      "description",
      "possibleDuplicateOf",
    ]);
    const content = body.input[0].content;
    expect(content[0].type).toBe("input_text");
    expect(content[0].text).toContain(
      "[Alex] (reacted message) (attached shot.png, notes.pdf)",
    );
    expect(content[0].text).toContain("3: Checkout freezes");
    expect(content.slice(1)).toEqual([
      {
        type: "input_image",
        image_url: `data:image/png;base64,${Buffer.from("png-bytes").toString("base64")}`,
        detail: "auto",
      },
    ]);
    expect(client.downloadImage).toHaveBeenCalledTimes(1);
    // Two authors in the thread, but each looked up once.
    expect(client.getUserName).toHaveBeenCalledTimes(2);
  });

  it("sends at most six images", async () => {
    const files = Array.from({ length: 8 }, (_, i) => image(`s${i}.png`));
    const client = slackClient([message(ROOT, { files })]);
    const fetchMock = stubOpenAi(goodOutput);

    await enrichTask(request, deps(client));

    expect(requestBody(fetchMock).input[0].content).toHaveLength(7);
  });

  it("notes truncation in the prompt", async () => {
    const thread = Array.from({ length: 205 }, (_, i) =>
      message(String(1000 + i)),
    );
    const client = slackClient(thread);
    const fetchMock = stubOpenAi(goodOutput);

    await enrichTask(
      { ...request, threadTs: "1000", reactedTs: "1000" },
      deps(client),
    );

    expect(requestBody(fetchMock).input[0].content[0].text).toContain(
      "(Thread truncated: 5 messages omitted.",
    );
  });

  it("rewrites title and description and comments as the filing user", async () => {
    const client = slackClient([message(ROOT)]);
    stubOpenAi({ ...goodOutput, possibleDuplicateOf: 3 });

    await enrichTask(request, deps(client));

    expect(mocks.updateTaskTitle).toHaveBeenCalledWith({
      id: "task-1",
      title: goodOutput.title,
      currentUserId: "user-1",
    });
    expect(mocks.updateTaskDescription).toHaveBeenCalledWith({
      id: "task-1",
      description: assembleDescription(
        goodOutput.description,
        original.description,
      ),
      currentUserId: "user-1",
    });
    const [taskId, userId, comment, external] = mocks.createComment.mock
      .calls[0] as [string, string, string, unknown];
    expect([taskId, userId, external]).toEqual(["task-1", "user-1", undefined]);
    expect(comment).toContain(`**Title:** ${goodOutput.title}`);
    expect(comment).toContain("Possible duplicate of PS-3");
    // The thread reply belongs to startTaskEnrichment, once the run settles.
    expect(client.postThreadReply).not.toHaveBeenCalled();
  });

  it("comments as Kaneo when the task was filed without a Kaneo user", async () => {
    stubOpenAi(goodOutput);

    await enrichTask(
      { ...request, actorId: null },
      deps(slackClient([message(ROOT)])),
    );

    expect(mocks.updateTaskTitle).toHaveBeenCalledWith(
      expect.objectContaining({ currentUserId: "" }),
    );
    expect(mocks.createComment.mock.calls[0]?.[3]).toEqual({
      userName: "Kaneo",
      source: "slack",
    });
  });

  it("keeps a title a person edited but still rewrites the description", async () => {
    mocks.taskFindFirst.mockResolvedValue({
      id: "task-1",
      title: "Edited by hand",
      description: original.description,
    });
    const client = slackClient([message(ROOT)]);
    stubOpenAi(goodOutput);

    await enrichTask(request, deps(client));

    expect(mocks.updateTaskTitle).not.toHaveBeenCalled();
    expect(mocks.updateTaskDescription).toHaveBeenCalledTimes(1);
    expect(mocks.createComment.mock.calls[0]?.[2]).toContain(
      "**Title:** kept — a person edited it first",
    );
  });

  it("keeps a description a person edited but still rewrites the title", async () => {
    mocks.taskFindFirst.mockResolvedValue({
      id: "task-1",
      title: original.title,
      description: "Written by a person",
    });
    stubOpenAi(goodOutput);

    await enrichTask(request, deps(slackClient([message(ROOT)])));

    expect(mocks.updateTaskTitle).toHaveBeenCalledTimes(1);
    expect(mocks.updateTaskDescription).not.toHaveBeenCalled();
  });

  it("discards a duplicate number that was not offered", async () => {
    stubOpenAi({ ...goodOutput, possibleDuplicateOf: 99 });

    await enrichTask(request, deps(slackClient([message(ROOT)])));

    expect(mocks.createComment.mock.calls[0]?.[2]).not.toContain(
      "Possible duplicate",
    );
  });

  it("retries once on invalid output and uses the second answer", async () => {
    const fetchMock = stubOpenAi("not json", goodOutput);

    await enrichTask(request, deps(slackClient([message(ROOT)])));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBody(fetchMock, 1).input.at(-1).content).toContain(
      "Your previous answer was rejected",
    );
    expect(mocks.updateTaskTitle).toHaveBeenCalledTimes(1);
  });

  it("gives up after a second invalid output without writing anything", async () => {
    const fetchMock = stubOpenAi(
      { ...goodOutput, title: "   " },
      { title: "missing fields" },
    );
    const client = slackClient([message(ROOT)]);

    await enrichTask(request, deps(client));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mocks.updateTaskTitle).not.toHaveBeenCalled();
    expect(mocks.updateTaskDescription).not.toHaveBeenCalled();
    expect(mocks.createComment).not.toHaveBeenCalled();
    expect(client.postThreadReply).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining('"outcome":"invalid_output"'),
    );
  });
});

describe("startTaskEnrichment", () => {
  it("does nothing without OPENAI_API_KEY and leaves the reply to the caller", async () => {
    const fetchMock = stubOpenAi(goodOutput);
    const client = slackClient([message(ROOT)]);

    expect(startTaskEnrichment(request, { client })).toBe(false);
    await new Promise((resolve) => setImmediate(resolve));

    expect(client.getThread).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(client.postThreadReply).not.toHaveBeenCalled();
  });

  it("replies once, after the rewrite, with the new title", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    stubOpenAi(goodOutput);
    const client = slackClient([message(ROOT)]);
    mocks.updateTaskTitle.mockImplementation(async () => {
      mocks.taskFindFirst.mockResolvedValue({
        id: "task-1",
        ...original,
        title: goodOutput.title,
      });
    });

    expect(startTaskEnrichment(request, { client })).toBe(true);
    await vi.waitFor(() => expect(client.postThreadReply).toHaveBeenCalled());

    expect(mocks.updateTaskTitle).toHaveBeenCalledTimes(1);
    expect(client.postThreadReply).toHaveBeenCalledTimes(1);
    expect(client.postThreadReply).toHaveBeenCalledWith({
      channel: "C1",
      threadTs: ROOT,
      text: `Created PS-7: ${goodOutput.title} — https://kaneo.test/task/task-1`,
    });
  });

  it("still replies with the filed title when the model gives up", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    stubOpenAi("not json", "still not json");
    const client = slackClient([message(ROOT)]);

    startTaskEnrichment(request, { client });
    await vi.waitFor(() => expect(client.postThreadReply).toHaveBeenCalled());

    expect(client.postThreadReply).toHaveBeenCalledWith(
      expect.objectContaining({
        text: `Created PS-7: ${original.title} — https://kaneo.test/task/task-1`,
      }),
    );
  });

  it("does not reply for a task deleted before the run settled", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    stubOpenAi(goodOutput);
    mocks.taskFindFirst.mockResolvedValue(undefined);
    const client = slackClient([message(ROOT)]);

    startTaskEnrichment(request, { client });
    await vi.waitFor(() =>
      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining('"outcome":"task_deleted"'),
      ),
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(client.postThreadReply).not.toHaveBeenCalled();
  });

  it("reads the key from OPENAI_API_KEY_FILE ahead of OPENAI_API_KEY", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kaneo-openai-"));
    const file = join(dir, "openai-api-key");
    writeFileSync(file, "sk-from-file\n");
    vi.stubEnv("OPENAI_API_KEY_FILE", file);
    vi.stubEnv("OPENAI_API_KEY", "sk-from-env");
    const fetchMock = stubOpenAi(goodOutput);

    startTaskEnrichment(request, { client: slackClient([message(ROOT)]) });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].headers,
    ).toMatchObject({ Authorization: "Bearer sk-from-file" });
    rmSync(dir, { recursive: true, force: true });
  });

  it("does nothing when OPENAI_API_KEY_FILE cannot be read", async () => {
    vi.stubEnv(
      "OPENAI_API_KEY_FILE",
      join(tmpdir(), "kaneo-missing-openai-key"),
    );
    vi.stubEnv("OPENAI_API_KEY", "sk-from-env");
    const fetchMock = stubOpenAi(goodOutput);
    const client = slackClient([message(ROOT)]);

    startTaskEnrichment(request, { client });
    await new Promise((resolve) => setImmediate(resolve));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(client.getThread).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("OPENAI_API_KEY_FILE"),
      expect.anything(),
    );
  });

  it("defaults the model to gpt-5.6-luna", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const fetchMock = stubOpenAi(goodOutput);

    startTaskEnrichment(request, { client: slackClient([message(ROOT)]) });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(requestBody(fetchMock).model).toBe("gpt-5.6-luna");
    expect(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].headers,
    ).toMatchObject({ Authorization: "Bearer sk-test" });
  });

  it("uses SLACK_TRIAGE_MODEL when set", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("SLACK_TRIAGE_MODEL", "gpt-custom");
    const fetchMock = stubOpenAi(goodOutput);

    startTaskEnrichment(request, { client: slackClient([message(ROOT)]) });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(requestBody(fetchMock).model).toBe("gpt-custom");
  });

  it("swallows and logs an OpenAI failure, then still replies", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500 }) as Response),
    );
    const client = slackClient([message(ROOT)]);

    expect(() => startTaskEnrichment(request, { client })).not.toThrow();
    await vi.waitFor(() =>
      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining('"outcome":"failed"'),
      ),
    );
    await vi.waitFor(() =>
      expect(client.postThreadReply).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringMatching(/^Created PS-7: /),
        }),
      ),
    );
    expect(mocks.updateTaskTitle).not.toHaveBeenCalled();
  });
});
