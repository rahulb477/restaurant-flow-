import { db } from "@/db";
import { files } from "@/db/schema";
import { api, ApiError } from "@/lib/server/http";
import { requireCtx } from "@/lib/server/auth";
import { serverEnv } from "@/config/env";

const TYPES = ["image/png", "image/jpeg", "image/webp"];

export const POST = api(async (req) => {
  const ctx = await requireCtx(["menu", "settings", "tables", "scratch"]);
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new ApiError("No file received.", 400, "NO_FILE");
  if (!TYPES.includes(file.type)) throw new ApiError("Only PNG, JPG, JPEG or WEBP images are allowed.", 415, "BAD_TYPE");
  const max = serverEnv.MAX_UPLOAD_MB * 1024 * 1024;
  if (file.size > max) throw new ApiError(`Image is too large. The maximum is ${serverEnv.MAX_UPLOAD_MB} MB.`, 413, "TOO_LARGE");
  const buf = Buffer.from(await file.arrayBuffer());
  const [row] = await db.insert(files).values({ restaurantId: ctx.restaurantId, contentType: file.type, size: buf.length, data: buf }).returning({ id: files.id });
  return { url: `/api/files/${row.id}` };
});
