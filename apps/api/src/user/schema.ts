import { z } from "../openapi";

export const uploadAvatarBody = z.object({
  contentType: z.string().openapi({
    description: "One of image/png, image/jpeg, or image/webp.",
    example: "image/png",
  }),
  data: z.string().openapi({ description: "Base64 encoded image bytes." }),
});

export const linkGithubIdentityBody = z.object({
  login: z
    .string()
    .trim()
    .min(1)
    .max(39)
    .regex(
      /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/,
      "Must be a valid GitHub username",
    )
    .openapi({
      description:
        "GitHub username to link. Resolved through GitHub, and the numeric account id it returns is what gets stored.",
      example: "ada",
    }),
});
