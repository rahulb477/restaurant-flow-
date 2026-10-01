import { api, readJson } from "@/lib/server/http";
import { requireCtx } from "@/lib/server/auth";
import { getDef, listResource, createResource } from "@/lib/server/services/crud";

type P = { resource: string };

export const GET = api<P>(async (req, { resource }) => {
  const d = getDef(resource);
  const ctx = await requireCtx(d.module);
  const u = new URL(req.url);
  return listResource(ctx, resource, { search: u.searchParams.get("q") ?? undefined, limit: Number(u.searchParams.get("limit")) || undefined, offset: Number(u.searchParams.get("offset")) || 0 });
});

export const POST = api<P>(async (req, { resource }) => {
  const d = getDef(resource);
  const ctx = await requireCtx(d.module);
  return createResource(ctx, resource, await readJson(req));
});
