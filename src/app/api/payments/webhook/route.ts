import { getPaymentProvider } from "@/lib/server/providers";
import { applyPaymentEvent } from "@/lib/server/services/payments";
import { errorResponse } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Provider webhook. The signature is verified over the RAW body before anything is parsed or applied. */
export async function POST(req: Request) {
  try {
    const provider = getPaymentProvider();
    if (!provider) return Response.json({ error: "Not found" }, { status: 404 });
    const raw = await req.text();
    const sig = req.headers.get("x-razorpay-signature") ?? req.headers.get("x-webhook-signature");
    if (!provider.verifyWebhook(raw, sig)) return Response.json({ error: "Invalid signature" }, { status: 401 });
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return Response.json({ error: "Bad request" }, { status: 400 });
    }
    const ev = provider.parseWebhook(body);
    if (!ev) return Response.json({ ok: true, ignored: true });
    const result = await applyPaymentEvent(ev);
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return errorResponse(e);
  }
}
