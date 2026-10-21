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

export const currentUserSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    image: z.string().nullable(),
    role: z.string().nullable(),
  })
  .openapi("CurrentUser");
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
});

export const githubIdentityStateSchema = z
  .object({
    identity: githubIdentityFields.nullable().openapi({
      description: "Null when the user has not connected a GitHub account.",
    }),
  })
  .openapi("UserGithubIdentityState");

export const githubIdentityUnlinkedSchema = z
  .object({
    success: z.boolean(),
  })
  .openapi("UserGithubIdentityUnlinked");
