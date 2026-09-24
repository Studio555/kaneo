import { responseTimestamp, z } from "../openapi";

export const columnSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    name: z.string(),
    slug: z.string().openapi({
      description:
        "Stable identifier derived from the name; tasks store this as their status.",
    }),
    position: z.number().openapi({
      description:
        "Order within the column's kind, ascending. Columns are always returned sorted by it.",
    }),
    icon: z.string().nullable(),
    color: z.string().nullable(),
    isFinal: z.boolean().openapi({
      description:
        "Marks the column as a done state, which stops overdue reminders for tasks in it.",
    }),
    kind: z.enum(["board", "backlog"]).openapi({
      description:
        "`board` columns make up the board; `backlog` columns are the backlog's sections.",
    }),
    systemKey: z.enum(["planned", "archived"]).nullable().openapi({
      description:
        "Set on the two built-in backlog sections every project has. They cannot be renamed or deleted.",
    }),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("Column");

export const columnListSchema = z.array(columnSchema);
