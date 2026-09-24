import { z } from "../openapi";

export const projectIdParam = z.object({ projectId: z.string() });

export const columnParam = z.object({ id: z.string() });

export const columnKindSchema = z.enum(["board", "backlog"]).openapi({
  description:
    "`board` columns make up the board; `backlog` columns are the backlog's sections.",
});

export const getColumnsQuery = z.object({
  kind: columnKindSchema.optional().openapi({
    description: "Which columns to list. Defaults to `board`.",
  }),
});

export const createColumnBody = z.object({
  name: z.string(),
  icon: z.string().optional(),
  color: z.string().optional(),
  isFinal: z.boolean().optional().openapi({
    description: "Not allowed for backlog sections.",
  }),
  kind: columnKindSchema.optional().openapi({
    description: "Defaults to `board`. Cannot be changed after creation.",
  }),
});

export const updateColumnBody = z.object({
  name: z.string().optional().openapi({
    description: "Built-in backlog sections cannot be renamed.",
  }),
  icon: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  isFinal: z.boolean().optional(),
});

export const reorderColumnsBody = z.object({
  columns: z.array(z.object({ id: z.string(), position: z.number() })).openapi({
    description:
      "Every column keeps its new position. Columns from another project are rejected.",
  }),
});
