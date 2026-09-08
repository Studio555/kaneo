import { z } from "../openapi";

export const avatarSchema = z
  .object({
    id: z.string(),
    url: z.string().openapi({
      description:
        "Public URL for the stored avatar, served from /api/user/avatar/{id}.",
    }),
    size: z.number().openapi({ description: "Decoded size in bytes." }),
  })
  .openapi("UserAvatar");

export const avatarDeletedSchema = z
  .object({
    deleted: z.boolean().openapi({
      description: "False when the user had no uploaded avatar to remove.",
    }),
  })
  .openapi("UserAvatarDeleted");

// Registering the nullable form would mark the shared UserGithubIdentity
// component itself nullable, and PUT — which always returns an identity —
// would inherit that. The state wrapper nullables the unregistered shape
// instead, so each response keeps its real contract.
const githubIdentityFields = z.object({
  githubUserId: z.string().openapi({
    description:
      "GitHub's numeric account id. This is the identity, because handles get renamed.",
    example: "4242",
  }),
  githubLogin: z.string().openapi({
    description: "Cached GitHub username, used when assigning issues.",
    example: "ada",
  }),
  verified: z.boolean().openapi({
    description:
      "True when GitHub proved the account belongs to this user through an OAuth sign-in. Only a verified link is trusted to route GitHub's own events back to a Kaneo user; an unverified one still drives assignment out to GitHub.",
    example: true,
  }),
});

export const githubIdentitySchema =
  githubIdentityFields.openapi("UserGithubIdentity");

export const githubIdentityStateSchema = z
  .object({
    identity: githubIdentityFields.nullable().openapi({
      description: "Null when the user has no linked GitHub account.",
    }),
  })
  .openapi("UserGithubIdentityState");

export const githubIdentityUnlinkedSchema = z
  .object({
    success: z.boolean(),
  })
  .openapi("UserGithubIdentityUnlinked");
