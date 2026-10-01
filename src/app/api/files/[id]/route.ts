import { eq } from "drizzle-orm";
import { db } from "@/db";
import { files } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const f = (await db.select().from(files).where(eq(files.id, id)).limit(1))[0];
  if (!f) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(f.data), { headers: { "Content-Type": f.contentType, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
}
