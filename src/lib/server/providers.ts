import crypto from "node:crypto";
import { serverEnv, integrations, publicEnv } from "@/config/env";
import { ApiError } from "./http";
import { buildUpiUri } from "@/lib/calculations";

/* ================================ Email ================================ */
export interface EmailProvider {
  isConfigured(): boolean;
  sendInvoice(to: string, subject: string, html: string): Promise<void>;
  sendStaffInvitation(to: string, restaurantName: string, link: string, role: string): Promise<void>;
  sendVerificationEmail(to: string, link: string): Promise<void>;
  sendPasswordReset(to: string, link: string): Promise<void>;
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
  sendVerificationEmail(to: string, link: string) {
    return this.send(to, "Verify your email", wrap("Verify your email", button(link, "Verify email")));
  }
  sendPasswordReset(to: string, link: string) {
    return this.send(to, "Reset your password", wrap("Reset your password", `<p>This link expires in 1 hour.</p>${button(link, "Reset password")}`));
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

/** Only used when NEXT_PUBLIC_DEMO_MODE=true and no AI provider is configured. */
class MockAIProvider implements AIProvider {
  isConfigured() {
    return true;
  }
  async digitizeMenu(): Promise<DigitizedMenu> {
    throw new ApiError("Menu digitization requires a configured AI provider.", 503, "AI_NOT_CONFIGURED");
  }
  async generateReview(input: { restaurantName: string; rating: number; items: string[] }) {
    const food = input.items.slice(0, 2).join(" and ") || "our order";
    return input.rating >= 4
      ? `Had a lovely time at ${input.restaurantName}. The ${food} was fresh and the service was quick. Would happily visit again!`
      : `Visited ${input.restaurantName} and tried ${food}. It was okay, with some room to improve on the experience.`;
  }
}
export const aiProvider: AIProvider = integrations.ai() ? new ConfiguredAIProvider() : publicEnv.demoMode ? new MockAIProvider() : new ConfiguredAIProvider();
export const digitizer: AIProvider = new ConfiguredAIProvider();

/* ================================ Payments ================================ */
export type PaymentIntent = { providerRef: string; status: "PENDING" | "PROCESSING" | "SUCCESS" | "FAILED"; action?: { type: "UPI_URI" | "CHECKOUT"; uri?: string } };
export interface PaymentProvider {
  name: string;
  isConfigured(): boolean;
  createPayment(o: { orderId: string; amountMinor: number; currency: string; upiId?: string; payeeName?: string; reference?: string }): Promise<PaymentIntent>;
  verifyPayment(o: { providerRef: string; paymentId?: string; signature?: string }): Promise<{ verified: boolean }>;
  getPaymentStatus(providerRef: string): Promise<PaymentIntent["status"]>;
  refundPayment(providerRef: string, amountMinor: number): Promise<{ refunded: boolean }>;
}

export const cashProvider: PaymentProvider = {
  name: "CASH",
  isConfigured: () => true,
  async createPayment(o) {
    return { providerRef: `cash:${o.orderId}`, status: "PENDING" };
  },
  async verifyPayment() {
    return { verified: false }; // cash is confirmed by staff in person
  },
  async getPaymentStatus() {
    return "PENDING";
  },
  async refundPayment() {
    return { refunded: false };
  },
};

export const upiProvider: PaymentProvider = {
  name: "UPI",
  isConfigured: () => true,
  async createPayment(o) {
    if (!o.upiId) throw new ApiError("UPI is not set up for this restaurant.", 400, "UPI_NOT_SET");
    return {
      providerRef: `upi:${o.orderId}`,
      status: "PENDING",
      action: { type: "UPI_URI", uri: buildUpiUri({ upiId: o.upiId, name: o.payeeName ?? "Merchant", amountMinor: o.amountMinor, ref: o.reference, note: o.reference, currency: o.currency }) },
    };
  },
  async verifyPayment() {
    return { verified: false }; // a UPI deep link cannot prove payment; staff confirm receipt
  },
  async getPaymentStatus() {
    return "PENDING";
  },
  async refundPayment() {
    return { refunded: false };
  },
};

/** Razorpay-compatible online provider; active only when configured in env. */
export const onlineProvider: PaymentProvider = {
  name: "ONLINE",
  isConfigured: () => integrations.onlinePayments(),
  async createPayment(o) {
    if (!this.isConfigured()) throw new ApiError("Online payments are not configured.", 503, "PAYMENT_NOT_CONFIGURED");
    const res = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`${serverEnv.PAYMENT_KEY_ID}:${serverEnv.PAYMENT_SECRET_KEY}`).toString("base64"), "Content-Type": "application/json" },
      body: JSON.stringify({ amount: o.amountMinor, currency: o.currency, receipt: o.reference ?? o.orderId }),
    });
    if (!res.ok) throw new ApiError("Could not start the online payment.", 502, "PAYMENT_FAILED");
    const data = (await res.json()) as { id: string };
    return { providerRef: data.id, status: "PENDING", action: { type: "CHECKOUT" } };
  },
  async verifyPayment(o) {
    if (!this.isConfigured() || !o.paymentId || !o.signature) return { verified: false };
    const expected = crypto.createHmac("sha256", serverEnv.PAYMENT_SECRET_KEY!).update(`${o.providerRef}|${o.paymentId}`).digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(o.signature);
    return { verified: a.length === b.length && crypto.timingSafeEqual(a, b) };
  },
  async getPaymentStatus(ref) {
    if (!this.isConfigured()) return "PENDING";
    const res = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(ref)}`, {
      headers: { Authorization: "Basic " + Buffer.from(`${serverEnv.PAYMENT_KEY_ID}:${serverEnv.PAYMENT_SECRET_KEY}`).toString("base64") },
    });
    if (!res.ok) return "FAILED";
    const d = (await res.json()) as { status: string };
    return d.status === "captured" ? "SUCCESS" : d.status === "failed" ? "FAILED" : "PROCESSING";
  },
  async refundPayment(ref, amountMinor) {
    if (!this.isConfigured()) return { refunded: false };
    const res = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(ref)}/refund`, {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`${serverEnv.PAYMENT_KEY_ID}:${serverEnv.PAYMENT_SECRET_KEY}`).toString("base64"), "Content-Type": "application/json" },
      body: JSON.stringify({ amount: amountMinor }),
    });
    return { refunded: res.ok };
  },
};

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
