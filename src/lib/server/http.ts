import { ZodError } from "zod";
import { OrderError } from "@/lib/calculations";

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = "BAD_REQUEST") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type Handler<P> = (req: Request, params: P) => Promise<unknown>;

/** Wraps a route handler: awaits params, serialises results, maps errors to human-readable JSON. */
export function api<P = Record<string, never>>(fn: Handler<P>) {
  return async (req: Request, ctx: { params: Promise<P> }): Promise<Response> => {
    try {
      const params = (await ctx.params) ?? ({} as P);
      const out = await fn(req, params);
      if (out instanceof Response) return out;
      return Response.json(out ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function errorResponse(e: unknown): Response {
  if (e instanceof ApiError) return Response.json({ error: e.message, code: e.code }, { status: e.status });
  if (e instanceof OrderError) return Response.json({ error: e.message, code: e.code }, { status: e.status });
  if (e instanceof ZodError) {
    const i = e.issues[0];
    return Response.json({ error: `${i.path.join(".") || "Input"}: ${i.message}`, code: "VALIDATION" }, { status: 400 });
  }
  const err = e as { code?: string | number; message?: string };
  // Firestore (gRPC) status codes: 6 = ALREADY_EXISTS, 5 = NOT_FOUND
  if (err?.code === 6 || err?.code === "already-exists") return Response.json({ error: "That already exists. Use a different value.", code: "DUPLICATE" }, { status: 409 });
  if (err?.code === 5 && typeof err.message === "string" && err.message.includes("NOT_FOUND")) return Response.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
  if (typeof err?.code === "string" && err.code.startsWith("auth/")) return Response.json({ error: "Authentication failed. Please sign in again.", code: "UNAUTHENTICATED" }, { status: 401 });
  console.error("[api] unexpected error:", err?.message ?? "unknown");
  return Response.json({ error: "Something went wrong on our side. Please try again.", code: "INTERNAL" }, { status: 500 });
}

export async function readJson<T = unknown>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiError("Invalid request body", 400, "BAD_JSON");
  }
}

const rate = new Map<string, { n: number; t: number }>();
/** Small in-memory limiter for sensitive public endpoints (per instance). */
export function rateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const e = rate.get(key);
  if (!e || now - e.t > windowMs) {
    rate.set(key, { n: 1, t: now });
    return;
  }
  e.n += 1;
  if (e.n > max) throw new ApiError("Too many attempts. Please wait a moment and try again.", 429, "RATE_LIMITED");
}
export function clientIp(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}
