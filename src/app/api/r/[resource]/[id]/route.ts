import { api, readJson } from "@/lib/server/http";
import { requireCtx } from "@/lib/server/auth";
import { getDef, updateResource, deleteResource } from "@/lib/server/services/crud";

type P = { resource: string; id: string };

export const PATCH = api<P>(async (req, { resource, id }) => {
  const ctx = await requireCtx(getDef(resource).module);
  return updateResource(ctx, resource, id, await readJson(req));
});

export const DELETE = api<P>(async (_req, { resource, id }) => {
  const ctx = await requireCtx(getDef(resource).module);
  return deleteResource(ctx, resource, id);
});
