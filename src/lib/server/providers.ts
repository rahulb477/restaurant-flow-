import crypto from "node:crypto";
import { serverEnv, integrations, publicEnv } from "@/config/env";
import { ApiError } from "./http";

/* ================================ Email ================================ */
export interface EmailProvider {
  isConfigured(): boolean;
  sendInvoice(to: string, subject: string, html: string): Promise<void>;
  sendStaffInvitation(to: string, restaurantName: string, link: string, role: string): Promise<void>;
  sendNotification(to: string, subject: string, html: string): Promise<void>;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const wrap = (title: string, body: string) =>
  `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px"><h2 style="margin:0 0 12px">${esc(title)}</h2>${body}<p style="color:#888;font-size:12px;margin-top:24px">Sent by ${esc(publicEnv.appName)}</p></div>`;
const button = (href: string, label: string) =>
  `<p><a href="${esc(href)}" style="background:#f59e0b;color:#111;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">${esc(label)}</a></p><p style="font-size:12px;color:#666">Or paste this link: ${esc(href)}</p>`;

class ConfiguredEmailProvider implements EmailProvider {
  isConfigured() {
    return integrations.email();
  }
  private async send(to: string, subject: string, html: string) {
    if (!this.isConfigured()) throw new ApiError("Email is not configured on this server. Add EMAIL_API_KEY and EMAIL_FROM.", 503, "EMAIL_NOT_CONFIGURED");
    let res: Response;
    try {
      res = await fetch(serverEnv.EMAIL_API_URL || "https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${serverEnv.EMAIL_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: serverEnv.EMAIL_FROM, to: [to], subject, html }),
      });
    } catch {
      throw new ApiError("Could not reach the email service. Please try again.", 502, "EMAIL_NETWORK");
    }
    if (!res.ok) throw new ApiError("The email provider rejected the message. Check your email configuration.", 502, "EMAIL_FAILED");
  }
  sendInvoice(to: string, subject: string, html: string) {
    return this.send(to, subject, html);
  }
  sendStaffInvitation(to: string, restaurantName: string, link: string, role: string) {
    return this.send(to, `You're invited to ${restaurantName}`, wrap(`Join ${restaurantName}`, `<p>You've been invited as <b>${esc(role)}</b>. The link expires in 7 days.</p>${button(link, "Accept invitation")}`));
  }
  sendNotification(to: string, subject: string, html: string) {
    return this.send(to, subject, wrap(subject, html));
  }
}
export const emailProvider: EmailProvider = new ConfiguredEmailProvider();

/* ================================== AI ================================== */
export type DigitizedMenu = { categories: { name: string; items: { name: string; price: number; description?: string }[] }[] };
export interface AIProvider {
  isConfigured(): boolean;
  digitizeMenu(base64: string, mime: string): Promise<DigitizedMenu>;
  generateReview(input: { restaurantName: string; rating: number; items: string[] }): Promise<string>;
}

async function chat(messages: unknown[], json = false): Promise<string> {
  const base = (serverEnv.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${serverEnv.AI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: serverEnv.AI_MODEL, messages, ...(json ? { response_format: { type: "json_object" } } : {}) }),
    });
  } catch {
    throw new ApiError("Could not reach the AI service. Please try again.", 502, "AI_NETWORK");
  }
  if (!res.ok) throw new ApiError("The AI service returned an error. Check AI configuration and try again.", 502, "AI_FAILED");
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new ApiError("The AI service returned an empty response.", 502, "AI_EMPTY");
  return text;
}

class ConfiguredAIProvider implements AIProvider {
  isConfigured() {
    return integrations.ai();
  }
  private assert() {
    if (!this.isConfigured()) throw new ApiError("AI is not configured on this server. Add AI_API_KEY and AI_MODEL.", 503, "AI_NOT_CONFIGURED");
  }
  async digitizeMenu(base64: string, mime: string): Promise<DigitizedMenu> {
    this.assert();
    const text = await chat(
      [
        {
          role: "system",
          content:
            'You extract restaurant menus from images. Reply ONLY with JSON: {"categories":[{"name":string,"items":[{"name":string,"price":number,"description":string}]}]}. Prices are plain numbers in the menu currency (no symbols). Do not invent items.',
        },
        { role: "user", content: [{ type: "text", text: "Extract every category and item with its price." }, { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } }] },
      ],
      true,
    );
    try {
      const parsed = JSON.parse(text.replace(/^```json|```$/g, "").trim()) as DigitizedMenu;
      if (!Array.isArray(parsed.categories)) throw new Error("shape");
      return {
        categories: parsed.categories
          .map((c) => ({
            name: String(c.name ?? "").slice(0, 80),
            items: (c.items ?? []).map((i) => ({ name: String(i.name ?? "").slice(0, 120), price: Math.max(0, Number(i.price) || 0), description: String(i.description ?? "").slice(0, 300) })).filter((i) => i.name),
          }))
          .filter((c) => c.name && c.items.length),
      };
    } catch {
      throw new ApiError("The AI could not read this menu. Try a clearer image.", 422, "AI_PARSE");
    }
  }
  async generateReview(input: { restaurantName: string; rating: number; items: string[] }) {
    this.assert();
    return (
      await chat([
        { role: "system", content: "You write short, natural, honest Google reviews (2-3 sentences, no hashtags, no emojis overload). Output only the review text." },
        { role: "user", content: `Write a ${input.rating}-star review for "${input.restaurantName}". The customer ordered: ${input.items.join(", ") || "a few items"}.` },
      ])
    ).trim();
  }
}

/** Single provider: when AI is not configured every call fails with an explicit AI_NOT_CONFIGURED error — results are never faked. */
export const aiProvider: AIProvider = new ConfiguredAIProvider();
export const digitizer: AIProvider = new ConfiguredAIProvider();

/* ================================ Payments ================================ */
export type ProviderPaymentStatus = "PENDING" | "PROCESSING" | "SUCCESS" | "FAILED" | "CANCELLED";
export type PaymentIntent = { providerRef: string; status: ProviderPaymentStatus; action?: { type: "REDIRECT"; url: string } };
export type WebhookEvent = { providerRef: string; restaurantId: string; orderId: string; status: ProviderPaymentStatus; amountMinor: number | null };

/**
 * Online-payment provider abstraction. The concrete adapter is selected by PAYMENT_PROVIDER in .env;
 * nothing is hard-wired to a specific gateway. Payment success is ONLY ever established by a verified
 * provider callback (webhook) or a server-side status lookup — never by the browser.
 */
export interface PaymentProvider {
  name: string;
  isConfigured(): boolean;
  createPayment(o: { restaurantId: string; orderId: string; displayId: string; amountMinor: number; currency: string; returnUrl: string; customer?: { name?: string; phone?: string; email?: string } }): Promise<PaymentIntent>;
  /** Verifies the authenticity of a webhook call from the RAW request body. */
  verifyWebhook(rawBody: string, signature: string | null): boolean;
  parseWebhook(body: unknown): WebhookEvent | null;
  getPaymentStatus(providerRef: string): Promise<ProviderPaymentStatus>;
  refundPayment(providerRef: string, amountMinor: number): Promise<{ refunded: boolean }>;
}

export const hmacHex = (secret: string, body: string) => crypto.createHmac("sha256", secret).update(body).digest("hex");
export const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/** Razorpay Payment Links adapter (redirect based — no client-side gateway script required). */
class RazorpayProvider implements PaymentProvider {
  name = "razorpay";
  private auth() {
    return "Basic " + Buffer.from(`${serverEnv.PAYMENT_KEY_ID}:${serverEnv.PAYMENT_SECRET_KEY}`).toString("base64");
  }
  isConfigured() {
    return integrations.onlinePayments();
  }
  async createPayment(o: Parameters<PaymentProvider["createPayment"]>[0]): Promise<PaymentIntent> {
    if (!this.isConfigured()) throw new ApiError("Online payments are not configured.", 503, "PAYMENT_NOT_CONFIGURED");
    const res = await fetch("https://api.razorpay.com/v1/payment_links", {
      method: "POST",
      headers: { Authorization: this.auth(), "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: o.amountMinor,
        currency: o.currency,
        reference_id: o.orderId,
        notes: { restaurantId: o.restaurantId, orderId: o.orderId },
        description: `Order ${o.displayId}`,
        customer: { name: o.customer?.name || undefined, contact: o.customer?.phone || undefined, email: o.customer?.email || undefined },
        callback_url: o.returnUrl,
        callback_method: "get",
      }),
    }).catch(() => null);
    if (!res || !res.ok) throw new ApiError("Could not start the online payment. Please try another method.", 502, "PAYMENT_FAILED");
    const d = (await res.json()) as { id: string; short_url: string };
    return { providerRef: d.id, status: "PROCESSING", action: { type: "REDIRECT", url: d.short_url } };
  }
  verifyWebhook(rawBody: string, signature: string | null) {
    const secret = serverEnv.PAYMENT_WEBHOOK_SECRET;
    if (!secret || !signature) return false;
    return safeEqual(hmacHex(secret, rawBody), signature);
  }
  parseWebhook(body: unknown): WebhookEvent | null {
    const b = body as { event?: string; payload?: { payment_link?: { entity?: { id?: string; notes?: { restaurantId?: string; orderId?: string }; amount?: number } } } };
    const link = b?.payload?.payment_link?.entity;
    const restaurantId = link?.notes?.restaurantId;
    const orderId = link?.notes?.orderId;
    if (!b?.event || !link?.id || !restaurantId || !orderId) return null;
    const status: ProviderPaymentStatus | null = b.event === "payment_link.paid" ? "SUCCESS" : b.event === "payment_link.cancelled" ? "CANCELLED" : b.event === "payment_link.expired" ? "FAILED" : null;
    if (!status) return null;
    return { providerRef: link.id, restaurantId, orderId, status, amountMinor: typeof link.amount === "number" ? link.amount : null };
  }
  async getPaymentStatus(ref: string): Promise<ProviderPaymentStatus> {
    if (!this.isConfigured()) return "PENDING";
    const res = await fetch(`https://api.razorpay.com/v1/payment_links/${encodeURIComponent(ref)}`, { headers: { Authorization: this.auth() } }).catch(() => null);
    if (!res?.ok) return "PROCESSING";
    const d = (await res.json()) as { status: string };
    return d.status === "paid" ? "SUCCESS" : d.status === "cancelled" ? "CANCELLED" : d.status === "expired" ? "FAILED" : "PROCESSING";
  }
  async refundPayment() {
    return { refunded: false }; // refunds are performed manually from the provider dashboard
  }
}

const REGISTRY: Record<string, () => PaymentProvider> = { razorpay: () => new RazorpayProvider() };

/** The online provider named by PAYMENT_PROVIDER, or null when none is configured. */
export function getPaymentProvider(): PaymentProvider | null {
  const name = serverEnv.PAYMENT_PROVIDER?.toLowerCase();
  const p = name ? REGISTRY[name]?.() : undefined;
  return p && p.isConfigured() ? p : null;
}

/* ================================== Maps ================================== */
export interface MapProvider {
  name: string;
  isConfigured(): boolean;
  embedUrl(lat: number, lng: number): string;
  pickerUrl(lat: number, lng: number): string;
}
/** OpenStreetMap needs no key; a keyed provider can be swapped in via NEXT_PUBLIC_MAP_PROVIDER. */
export const mapProvider: MapProvider = {
  name: "openstreetmap",
  isConfigured: () => true,
  embedUrl: (lat, lng) => `https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.004}%2C${lat - 0.003}%2C${lng + 0.004}%2C${lat + 0.003}&layer=mapnik&marker=${lat}%2C${lng}`,
  pickerUrl: (lat, lng) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`,
};
