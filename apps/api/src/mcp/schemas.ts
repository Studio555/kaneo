import { z } from "../openapi";

// Redirect URIs are attacker-supplied during dynamic client registration, so
// anything that could turn into script execution or credential leakage is
// rejected: fragments, embedded credentials, and script-bearing schemes.
// Plain http is allowed only for loopback, per OAuth 2.1 for native apps.
function isValidRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.hash || url.username || url.password) return false;
    if (["javascript:", "data:", "file:", "vbscript:"].includes(url.protocol)) {
      return false;
    }
    if (url.protocol === "http:") {
      return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    }
    return (
      url.protocol === "https:" || /^[a-z][a-z0-9+.-]*:$/.test(url.protocol)
    );
  } catch {
    return false;
  }
}

const redirectUriSchema = z
  .string()
  .max(2048)
  .refine(isValidRedirectUri, "Invalid redirect URI");

// The single source of truth for what this endpoint supports: the registration schema below, the
// metadata a registered client is handed back, and the advertised authorization server metadata all
// read from here, so a client can never be accepted for a grant the server does not implement.
export const SUPPORTED_GRANT_TYPES = ["authorization_code"] as const;
export const SUPPORTED_RESPONSE_TYPES = ["code"] as const;

// A client may ask for more than the server implements -- Claude Code requests refresh_token
// alongside authorization_code -- so extra values are tolerated here and dropped from the
// registered metadata rather than failing the registration (RFC 7591 section 3.2.1).
export const clientRegistrationSchema = z.object({
  redirect_uris: z.array(redirectUriSchema).min(1),
  client_name: z.string().max(100).optional(),
  token_endpoint_auth_method: z.literal("none").optional(),
  grant_types: z
    .array(z.string())
    .min(1)
    .refine((values) => values.includes("authorization_code"), {
      message: "grant_types must include authorization_code",
    })
    .optional(),
  response_types: z
    .array(z.string())
    .min(1)
    .refine((values) => values.includes("code"), {
      message: "response_types must include code",
    })
    .optional(),
});

export const authorizationQuerySchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string(),
  redirect_uri: redirectUriSchema,
  code_challenge: z.string().min(1).openapi({
    description: "PKCE challenge; only S256 is accepted.",
  }),
  code_challenge_method: z.literal("S256"),
  state: z.string().optional(),
});

export const authorizationRequestParamSchema = z.object({
  requestId: z.string(),
});

export const authorizationDecisionSchema = z.object({
  approved: z.boolean(),
});

export const oauthErrorSchema = z
  .object({ error: z.string() })
  .openapi("OAuthError");

export const clientRegistrationResponseSchema = z
  .object({
    client_id: z.string(),
    client_id_issued_at: z.number(),
    redirect_uris: z.array(z.string()),
    client_name: z.string().optional(),
    token_endpoint_auth_method: z.literal("none"),
    grant_types: z.array(z.enum(SUPPORTED_GRANT_TYPES)),
    response_types: z.array(z.enum(SUPPORTED_RESPONSE_TYPES)),
  })
  .openapi("McpClientRegistration");

export const authorizationRequestResponseSchema = z
  .object({ client_name: z.string(), redirect_uri: z.string() })
  .openapi("McpAuthorizationRequest");

export const authorizationDecisionResponseSchema = z
  .object({
    redirect: z.string().openapi({
      description:
        "Where to send the browser next: back to the client with a code on approval, or with an error on denial.",
    }),
  })
  .openapi("McpAuthorizationDecision");
