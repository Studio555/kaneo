import { z } from "zod";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_TIMEOUT_MS = 90_000;
const MAX_ATTEMPTS = 2;
const TITLE_MAX_CHARS = 80;
const FIELD_MAX_CHARS = 1200;
const QUESTION_MAX_CHARS = 300;
const MAX_QUESTIONS = 6;

// Kept constant so the provider can cache the prefix across runs.
export const ENRICHMENT_INSTRUCTIONS = `You turn a Slack post that a person filed into Kaneo, the Showrooms team's task tracker, into a well-defined task. Showrooms is a Studio555 interior-design app with a Unity client, backends and content tooling.

You get the task as the Slack bot filed it, the full Slack thread (oldest first, the reacted message marked), the images posted in the thread, and the numbers and titles of recent tasks in the same project. Write:
- "title": at most 80 characters, specific, naming the symptom and the place (for example "Sofa clips through wall after rotate in room editor"), never "Bug" or "Issue in app".
- "description.summary": one or two plain sentences on what is wrong or what is asked.
- "description.observed": what the reporter saw, in their terms, and what the screenshots show (the screen, the visible problem, any error text you can read).
- "description.where": screen, feature, platform, device or build, as the thread states.
- "description.repro": steps only if the thread states them, else an empty string.
- "description.openQuestions": every fact an engineer would need that the thread does not give (build, device, steps, expected behaviour, frequency).
- "possibleDuplicateOf": the number of a listed recent task that clearly reports the same problem, else null. Similar area is not enough.

Rules:
- Use only facts in the task, the thread and the images. Never invent reproduction steps, versions, devices or causes. A missing fact goes into openQuestions, not into another field.
- Keep the reporter's terms. Later replies may correct or add to the first post; the thread as a whole is the report.
- Write in English, in a neutral tone, without markdown headings.`;

const ENRICHMENT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "description", "possibleDuplicateOf"],
  properties: {
    title: { type: "string" },
    description: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "observed", "where", "repro", "openQuestions"],
      properties: {
        summary: { type: "string" },
        observed: { type: "string" },
        where: { type: "string" },
        repro: { type: "string" },
        openQuestions: { type: "array", items: { type: "string" } },
      },
    },
    possibleDuplicateOf: { type: ["integer", "null"] },
  },
} as const;

function clip(text: string, limit: number): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length <= limit
    ? trimmed
    : `${trimmed.slice(0, limit - 1).trimEnd()}…`;
}

function field(limit: number) {
  return z.string().transform((value) => value.trim().slice(0, limit));
}

const enrichmentSchema = z.object({
  title: z
    .string()
    .transform((value) => clip(value, TITLE_MAX_CHARS))
    .pipe(z.string().min(1, "title is empty")),
  description: z.object({
    summary: field(FIELD_MAX_CHARS),
    observed: field(FIELD_MAX_CHARS),
    where: field(FIELD_MAX_CHARS),
    repro: field(FIELD_MAX_CHARS),
    openQuestions: z.array(z.string()).transform((questions) =>
      questions
        .map((question) => clip(question, QUESTION_MAX_CHARS))
        .filter(Boolean)
        .slice(0, MAX_QUESTIONS),
    ),
  }),
  possibleDuplicateOf: z.number().int().nullable(),
});

export type Enrichment = z.infer<typeof enrichmentSchema>;

export type EnrichmentUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
};

type ResponsesPayload = {
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string; refusal?: string }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
  };
};

function outputText(payload: ResponsesPayload): string | null {
  for (const item of payload.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part.type === "output_text" && part.text) return part.text;
    }
  }
  return null;
}

function parseEnrichment(text: string | null): Enrichment | string {
  if (!text) {
    return "no output text";
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return "output is not JSON";
  }

  const parsed = enrichmentSchema.safeParse(json);
  return parsed.success
    ? parsed.data
    : parsed.error.issues.map((issue) => issue.message).join("; ");
}

/**
 * One Responses call per attempt; the only retry is for output that fails
 * validation, never for HTTP or network failures, which throw.
 */
export async function requestEnrichment({
  apiKey,
  model,
  text,
  imageDataUrls,
}: {
  apiKey: string;
  model: string;
  text: string;
  imageDataUrls: string[];
}): Promise<{
  enrichment: Enrichment | null;
  error: string | null;
  attempts: number;
  usage: EnrichmentUsage;
}> {
  const input: unknown[] = [
    {
      role: "user",
      content: [
        { type: "input_text", text },
        ...imageDataUrls.map((url) => ({
          type: "input_image",
          image_url: url,
          detail: "auto",
        })),
      ],
    },
  ];
  const usage: EnrichmentUsage = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
  };
  let error: string | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
    let payload: ResponsesPayload;

    try {
      const response = await fetch(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          instructions: ENRICHMENT_INSTRUCTIONS,
          input,
          store: false,
          text: {
            format: {
              type: "json_schema",
              name: "task_enrichment",
              strict: true,
              schema: ENRICHMENT_JSON_SCHEMA,
            },
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`OpenAI responses failed with HTTP ${response.status}`);
      }

      payload = (await response.json()) as ResponsesPayload;
    } finally {
      clearTimeout(timeoutId);
    }

    usage.inputTokens += payload.usage?.input_tokens ?? 0;
    usage.cachedInputTokens +=
      payload.usage?.input_tokens_details?.cached_tokens ?? 0;
    usage.outputTokens += payload.usage?.output_tokens ?? 0;

    const result = parseEnrichment(outputText(payload));
    if (typeof result !== "string") {
      return { enrichment: result, error: null, attempts: attempt, usage };
    }

    error = result;
    input.push({
      role: "user",
      content: `Your previous answer was rejected: ${result}. Answer again, following the rules.`,
    });
  }

  return { enrichment: null, error, attempts: MAX_ATTEMPTS, usage };
}
