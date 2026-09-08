import { HTTPException } from "hono/http-exception";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { MAX_AVATAR_BYTES } from "./avatar";
import deleteAvatar from "./controllers/delete-avatar";
import getGithubIdentity from "./controllers/get-github-identity";
import linkGithubIdentity from "./controllers/link-github-identity";
import saveAvatar from "./controllers/save-avatar";
import unlinkGithubIdentity from "./controllers/unlink-github-identity";
import {
  avatarDeletedSchema,
  avatarSchema,
  githubIdentitySchema,
  githubIdentityStateSchema,
  githubIdentityUnlinkedSchema,
} from "./response";
import { linkGithubIdentityBody, uploadAvatarBody } from "./schema";

const uploadAvatarRoute = createRoute({
  method: "put",
  operationId: "uploadUserAvatar",
  path: "/avatar",
  tags: ["User"],
  summary: "Upload avatar",
  description: `Store a base64 encoded avatar (PNG, JPEG, or WebP, up to ${Math.floor(
    MAX_AVATAR_BYTES / 1024,
  )}KB) for the current user and return its public URL. Replaces any existing avatar.`,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: uploadAvatarBody } },
    },
  },
  responses: {
    200: jsonResponse("Avatar stored", avatarSchema),
    400: errorResponse(
      "Unsupported content type, malformed base64, or too large",
    ),
  },
});

const deleteAvatarRoute = createRoute({
  method: "delete",
  operationId: "deleteUserAvatar",
  path: "/avatar",
  tags: ["User"],
  summary: "Delete avatar",
  description:
    "Remove the uploaded avatar of the current user. Succeeds even when there was nothing to remove.",
  responses: {
    200: jsonResponse("Avatar removed", avatarDeletedSchema),
  },
});

const getGithubIdentityRoute = createRoute({
  method: "get",
  operationId: "getUserGithubIdentity",
  path: "/github-identity",
  tags: ["User"],
  summary: "Get linked GitHub account",
  description:
    "Return the GitHub account linked to the current user, so task assignment can name the same person on a linked GitHub issue. Null when nothing is linked.",
  responses: {
    200: jsonResponse("Current GitHub link", githubIdentityStateSchema),
  },
});

const linkGithubIdentityRoute = createRoute({
  method: "put",
  operationId: "linkUserGithubIdentity",
  path: "/github-identity",
  tags: ["User"],
  summary: "Link a GitHub account",
  description:
    "Link a GitHub username to the current user. The username is resolved through GitHub and its numeric account id is stored, so a rename keeps working. Replaces any existing link.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: linkGithubIdentityBody } },
    },
  },
  responses: {
    200: jsonResponse("GitHub account linked", githubIdentitySchema),
    404: errorResponse("No GitHub user exists for that username"),
    409: errorResponse("That GitHub account is linked to another user"),
    503: errorResponse("GitHub integration is not configured"),
  },
});

const unlinkGithubIdentityRoute = createRoute({
  method: "delete",
  operationId: "unlinkUserGithubIdentity",
  path: "/github-identity",
  tags: ["User"],
  summary: "Unlink the GitHub account",
  description:
    "Remove the current user's GitHub link. Succeeds even when there was nothing to remove.",
  responses: {
    200: jsonResponse("GitHub account unlinked", githubIdentityUnlinkedSchema),
  },
});

const user = apiRouter()
  .openapi(uploadAvatarRoute, async (c) => {
    const { contentType, data } = c.req.valid("json");
    try {
      return c.json(
        await saveAvatar({ userId: c.get("userId"), contentType, data }),
        200,
      );
    } catch (error) {
      throw new HTTPException(400, {
        message:
          error instanceof Error ? error.message : "Invalid avatar upload",
      });
    }
  })
  .openapi(deleteAvatarRoute, async (c) =>
    c.json(await deleteAvatar(c.get("userId")), 200),
  )
  .openapi(getGithubIdentityRoute, async (c) =>
    c.json({ identity: await getGithubIdentity(c.get("userId")) }, 200),
  )
  .openapi(linkGithubIdentityRoute, async (c) => {
    const { login } = c.req.valid("json");
    return c.json(
      await linkGithubIdentity({ userId: c.get("userId"), login }),
      200,
    );
  })
  .openapi(unlinkGithubIdentityRoute, async (c) =>
    c.json(await unlinkGithubIdentity(c.get("userId")), 200),
  );

export default user;
