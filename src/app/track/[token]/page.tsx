"use client";
import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Copy, ExternalLink, Gift, Sparkles, Star, WifiOff } from "lucide-react";
import { post, useApi } from "@/lib/client/api";
import { usePublicOrderLive } from "@/lib/client/realtime";
import { formatMoney } from "@/lib/calculations";
import { Button, Card, ErrorState, Notice, Skeleton, StatusBadge, Textarea, cx, useToast } from "@/components/ui";
import { ItemLines, Timeline, Totals, type OrderRow } from "@/components/order-ui";
import { UpiQr } from "@/components/upi";

type Data = {
  order: OrderRow;
  restaurant: { name: string; slug: string; logoUrl: string; accent: string; currency: string; googleReviewUrl: string; settings: { payments: { cash: boolean; upi: boolean } } };
  upi: { upiId: string; name: string } | null;
  onlinePay?: boolean;
  loyalty: { visits: number; required: number; rewardTitle: string; rewards: { id: string; title: string; status: string; code: string }[] } | null;
  scratch: { status: string; reward: string; code: string } | null;
  review: { rating: number; text: string } | null;
};

const contrast = (hex: string) => { const n = parseInt(hex.slice(1), 16); return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.6 ? "#111111" : "#ffffff"; };

export default function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const base = useApi<Data>(`/api/public/order?token=${token}`);
  const { error, reload } = base;
  // Firestore listener on the customer-safe order projection: status/payment changes arrive instantly.
  const live = usePublicOrderLive<{ status: string; paymentStatus: string; paymentMethod: string | null }>(token);
  const liveKey = live.data ? `${live.data.status}|${live.data.paymentStatus}` : "";
  const seen = useRef(liveKey);
  useEffect(() => {
    if (liveKey && liveKey !== seen.current) { seen.current = liveKey; reload(); }
  }, [liveKey, reload]);
  const data = base.data && live.data ? { ...base.data, order: { ...base.data.order, status: live.data.status, paymentStatus: live.data.paymentStatus, paymentMethod: live.data.paymentMethod } } : base.data;
  const [paying, setPaying] = useState(false);
  const toast = useToast();
  async function payOnline() {
    setPaying(true);
    try { const r = await post<{ url: string }>("/api/public/pay", { token }); if (r.url) window.location.href = r.url; else toast.error("The payment page could not be opened."); } catch (e) { toast.error((e as Error).message); } finally { setPaying(false); }
  }
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const net = (e: Event) => setOffline(!(e as CustomEvent).detail.ok);
    window.addEventListener("cp-network", net);
    return () => window.removeEventListener("cp-network", net);
  }, []);
  if (error && !data) return <div className="mx-auto max-w-lg p-6"><ErrorState message={error} onRetry={reload} /></div>;
  if (!data) return <div className="mx-auto max-w-lg space-y-3 p-4"><Skeleton className="h-20" /><Skeleton className="h-32" /><Skeleton className="h-40" /></div>;
  const { order: o, restaurant: r } = data;
  const accent = /^#[0-9a-f]{6}$/i.test(r.accent) ? r.accent : "#f59e0b";
  const m = (n: number) => formatMoney(n, r.currency);
  return (
    <div style={{ ["--accent" as string]: accent, ["--accent-fg" as string]: contrast(accent) }} className="mx-auto min-h-screen max-w-lg space-y-4 p-4 pb-12">
      {offline && <div role="alert" className="flex items-center justify-center gap-2 rounded-lg bg-warn/15 py-2 text-sm text-warn"><WifiOff className="size-4" />Connection lost. Reconnecting…</div>}
      <header className="flex items-center gap-3">
        {r.logoUrl ?   <img src={r.logoUrl} alt="" className="size-11 rounded-xl object-cover" /> : <div className="grid size-11 place-items-center rounded-xl bg-accent font-display font-bold text-accent-fg">{r.name[0]}</div>}
        <div className="flex-1"><p className="font-display text-lg font-semibold leading-tight">{r.name}</p><p className="text-xs text-muted">Order {o.displayId}{o.tableName ? ` · Table ${o.tableName}` : ""}</p></div>
        <StatusBadge status={o.paymentStatus} />
      </header>

      <Card className="p-5"><Timeline status={o.status} /><p className="mt-4 text-center text-sm text-muted">{statusText(o.status, o.paymentStatus)}</p></Card>

      {o.paymentStatus !== "SUCCESS" && o.status !== "CANCELLED" && (
        <Card className="p-5">
          <h2 className="font-semibold">Payment</h2>
          {o.paymentTiming === "PAY_FIRST" && o.status === "PAYMENT_PENDING" && <p className="mt-1 text-sm text-warn">Your order will be sent to the kitchen once payment is confirmed.</p>}
          {data.onlinePay && <Button className="mt-4 w-full" size="lg" loading={paying} onClick={payOnline}>Pay {m(o.total)} online</Button>}
          {o.paymentStatus === "PROCESSING" && <p className="mt-3 text-sm text-warn">Your online payment is being confirmed. This page will update automatically.</p>}
          {data.upi ? (
            <div className="mt-4"><UpiQr upiId={data.upi.upiId} name={data.upi.name} amountMinor={o.total} orderRef={o.displayId} currency={r.currency} size={180} />
              <p className="mt-3 text-center text-xs text-muted">After paying, staff will confirm receipt and your status will update here.</p></div>
          ) : <p className="mt-1 text-sm text-muted">{r.settings.payments.cash ? "Please pay at the counter." : "Please ask staff how to pay."}</p>}
        </Card>
      )}

      <Card className="space-y-4 p-5"><h2 className="font-semibold">Your items</h2><ItemLines items={o.items} currency={r.currency} /><div className="border-t border-line pt-3"><Totals o={o} currency={r.currency} /></div>{o.customerNotes && <p className="text-xs text-muted">Note: {o.customerNotes}</p>}<p className="text-xs text-muted">Total {m(o.total)}</p></Card>

      {o.status === "COMPLETED" && (<>
        {data.loyalty && <Loyalty token={token} data={data.loyalty} onChange={reload} />}
        {data.scratch && <Scratch token={token} initial={data.scratch} />}
        <Review token={token} name={r.name} googleUrl={r.googleReviewUrl} existing={data.review} onSaved={reload} />
      </>)}
      {o.status !== "COMPLETED" && o.status !== "CANCELLED" && <p className="text-center text-xs text-muted">This page updates automatically.</p>}
      <Link href={`/order/${r.slug}`} className="block text-center text-sm text-accent">Back to menu</Link>
    </div>
  );
}

function statusText(s: string, pay: string) {
  return ({ PLACED: "We’ve received your order. Waiting for the restaurant to confirm.", PAYMENT_PENDING: "Waiting for payment confirmation.", PAYMENT_COMPLETED: "Payment received. Waiting for confirmation.", CONFIRMED: "Confirmed — it’s heading to the kitchen.", PREPARING: "The kitchen is preparing your order.", READY: "Your order is ready!", SERVED: pay === "SUCCESS" ? "Enjoy your meal!" : "Enjoy! Please complete payment at the counter.", COMPLETED: "Thank you for visiting!", CANCELLED: "This order was cancelled." } as Record<string, string>)[s] ?? "";
}

function Loyalty({ token, data, onChange }: { token: string; data: NonNullable<Data["loyalty"]>; onChange: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  async function claim(id: string) {
    setBusy(id);
    try { const r = await post<{ code: string }>("/api/public/loyalty-claim", { token, rewardId: id }); toast.success(`Reward claimed! Show code ${r.code}`); onChange(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  }
  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-semibold"><Gift className="size-4 text-accent" />Loyalty</h2>
      <p className="mt-2 text-sm">{data.visits} / {data.required} visits <span className="text-muted">→ {data.rewardTitle}</span></p>
      <div className="mt-2 flex gap-1.5" role="progressbar" aria-valuemin={0} aria-valuemax={data.required} aria-valuenow={data.visits}>{Array.from({ length: data.required }).map((_, i) => <div key={i} className={cx("h-2 flex-1 rounded-full", i < data.visits ? "bg-accent" : "bg-surface2")} />)}</div>
      {data.rewards.filter((x) => x.status === "UNLOCKED").map((x) => (
        <div key={x.id} className="mt-4 flex items-center justify-between rounded-xl bg-accent/10 p-3"><div><p className="text-sm font-semibold">🎉 Reward unlocked</p><p className="text-xs text-muted">{x.title}</p></div><Button size="sm" loading={busy === x.id} onClick={() => claim(x.id)}>Claim</Button></div>
      ))}
      {data.rewards.filter((x) => x.status === "CLAIMED" && x.code).slice(-2).map((x) => <p key={x.id} className="mt-3 text-xs text-muted">Claimed: {x.title} · code <b className="text-white">{x.code}</b></p>)}
    </Card>
  );
}

function Scratch({ token, initial }: { token: string; initial: NonNullable<Data["scratch"]> }) {
  const toast = useToast();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState(initial);
  const [revealed, setRevealed] = useState(initial.status !== "ISSUED");
  const [cleared, setCleared] = useState(initial.status !== "ISSUED");
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  const moves = useRef(0);

  useEffect(() => {
    const c = canvas.current;
    if (!c || revealed) return;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#3f3f47"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = "#9a9aa5"; ctx.font = "600 16px sans-serif"; ctx.textAlign = "center"; ctx.fillText("Scratch here ✨", c.width / 2, c.height / 2 + 5);
  }, [revealed]);

  async function reveal() {
    if (started.current) return;
    started.current = true;
    try { const r = await post<{ reward: string; status: string }>("/api/public/scratch-reveal", { token }); setState({ status: r.status, reward: r.reward, code: "" }); setRevealed(true); } catch (e) { toast.error((e as Error).message); started.current = false; }
  }
  function scratch(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.buttons === 0 && e.pointerType === "mouse") return;
    const c = canvas.current!;
    const rect = c.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * c.width, y = ((e.clientY - rect.top) / rect.height) * c.height;
    const ctx = c.getContext("2d")!;
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath(); ctx.arc(x, y, 18, 0, Math.PI * 2); ctx.fill();
    reveal();
    if (++moves.current % 8 === 0) {
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let clear = 0;
      for (let i = 3; i < d.length; i += 160) if (d[i] === 0) clear++;
      if (clear / (d.length / 160) > 0.4) setCleared(true);
    }
  }
  async function claim() {
    setBusy(true);
    try { const r = await post<{ code: string }>("/api/public/scratch-claim", { token }); setState({ ...state, status: "CLAIMED", code: r.code }); toast.success("Reward claimed!"); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-accent" />Scratch card</h2>
      <div className="relative mx-auto mt-4 h-36 w-full max-w-xs overflow-hidden rounded-2xl border border-line bg-surface2">
        <div className="absolute inset-0 grid place-items-center p-4 text-center">{revealed ? (state.reward ? <div><p className="text-xs text-muted">You won</p><p className="font-display text-xl font-semibold text-accent">{state.reward}</p></div> : <p className="text-sm text-muted">Better luck next time!</p>) : <span className="text-2xl">🎁</span>}</div>
        {!revealed || !cleared ? <canvas ref={canvas} width={320} height={144} onPointerMove={scratch} onPointerDown={scratch} className={cx("scratch-surface absolute inset-0 size-full cursor-pointer", revealed && "opacity-90")} aria-label="Scratch to reveal your reward" /> : null}
      </div>
      {revealed && cleared && state.reward && state.status === "REVEALED" && <Button className="mt-4 w-full" loading={busy} onClick={claim}>Claim reward</Button>}
      {state.status === "CLAIMED" && state.code && <p className="mt-4 text-center text-sm">Show this code to staff: <b className="text-accent">{state.code}</b></p>}
    </Card>
  );
}

function Review({ token, name, googleUrl, existing, onSaved }: { token: string; name: string; googleUrl: string; existing: Data["review"]; onSaved: () => void }) {
  const toast = useToast();
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [text, setText] = useState(existing?.text ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function draft(r: number) {
    setRating(r); setErr(""); setBusy(true);
    try { const d = await post<{ text: string }>("/api/public/review-draft", { token, rating: r }); setText(d.text); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function save() { try { await post("/api/public/review", { token, rating, text }); onSaved(); } catch (e) { toast.error((e as Error).message); } }
  async function copyAndOpen() {
    try { await navigator.clipboard.writeText(text); toast.success("Review copied — paste it on Google"); } catch { toast.info("Copy the text manually, then open Google"); }
    await save();
    if (googleUrl) window.open(googleUrl, "_blank", "noopener,noreferrer");
  }
  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-semibold"><Star className="size-4 text-accent" />How was {name}?</h2>
      <div className="mt-3 flex gap-1" role="radiogroup" aria-label="Rating">{[1, 2, 3, 4, 5].map((n) => <button key={n} role="radio" aria-checked={rating === n} aria-label={`${n} star${n > 1 ? "s" : ""}`} onClick={() => draft(n)} className="p-1"><Star className={cx("size-8 transition", n <= rating ? "fill-accent text-accent" : "text-muted")} /></button>)}</div>
      {err && <div className="mt-3"><Notice tone="warn">{err}</Notice></div>}
      {rating > 0 && (
        <div className="mt-4 space-y-3">
          <Textarea aria-label="Your review" value={busy ? "Writing a suggestion…" : text} onChange={(e) => setText(e.target.value)} disabled={busy} placeholder="Write a few words about your visit (optional)" />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(text); toast.success("Copied"); } catch { toast.error("Couldn’t copy automatically"); } }} disabled={!text}><Copy className="size-4" />Copy</Button>
            {googleUrl ? <Button onClick={copyAndOpen} disabled={!text}><ExternalLink className="size-4" />Copy & open Google</Button> : <Button onClick={async () => { await save(); toast.success("Thanks for your feedback!"); }}><Check className="size-4" />Submit feedback</Button>}
          </div>
          <p className="text-xs text-muted">Reviews are never posted for you — you stay in control and submit on Google yourself.</p>
        </div>
      )}
    </Card>
  );
}
