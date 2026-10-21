import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { craftTable } from "../../database/schema";

async function getCraft(id: string) {
  const craft = await db.query.craftTable.findFirst({
    where: eq(craftTable.id, id),
  });

  if (!craft) {
    throw new HTTPException(404, { message: "Craft not found" });
  }

  return craft;
}

export default getCraft;
