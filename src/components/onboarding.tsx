"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Coffee, CreditCard, Hotel, MapPin, Rocket, Store, UtensilsCrossed, ChefHat } from "lucide-react";
import { patch, post } from "@/lib/client/api";
import { Button, Card, Field, Input, Notice, cx } from "./ui";
import { Logo } from "./marketing";

 
type R = Record<string, any>;
const TYPES = [["CAFE", "Cafe", Coffee], ["RESTAURANT", "Restaurant", UtensilsCrossed], ["HOTEL", "Hotel", Hotel], ["CLOUD_KITCHEN", "Cloud Kitchen", ChefHat], ["OTHER", "Other", Store]] as const;

export function Onboarding({ initial, email }: { initial: R | null; email: string }) {
  const router = useRouter();
  const [step, setStep] = useState(initial ? Math.max(2, Math.min(initial.onboardingStep, 7)) : 1);
  const [created, setCreated] = useState(!!initial);
  const [d, setD] = useState<R>({
    name: initial?.name ?? "", businessType: initial?.businessType ?? "CAFE", phone: initial?.phone ?? "", email: initial?.email ?? email, address: initial?.address ?? "", city: initial?.city ?? "",
    state: initial?.state ?? "", country: initial?.country ?? "India", pincode: initial?.pincode ?? "", latitude: initial?.latitude ?? "", longitude: initial?.longitude ?? "",
    paymentTiming: initial?.settings?.paymentTiming ?? "PAY_AT_END", feeMode: initial?.settings?.fees?.mode ?? "CUSTOMER_BASED",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [geoMsg, setGeoMsg] = useState("");
  const set = (k: string, v: unknown) => setD((s) => ({ ...s, [k]: v }));
  const num = (v: unknown) => (v === "" || v == null ? null : Number(v));

  async function next(skip = false) {
    setErr(""); setBusy(true);
    try {
      if (step === 1) {
        if (!d.name.trim()) throw new Error("Enter your business name.");
        if (!created) { await post("/api/restaurant", { name: d.name, businessType: d.businessType }); setCreated(true); }
        else await patch("/api/restaurant", { name: d.name, onboardingStep: 2 });
      } else if (step === 2) await patch("/api/restaurant", { businessType: d.businessType, onboardingStep: 3 });
      else if (step === 3) await patch("/api/restaurant", skip ? { onboardingStep: 4 } : { phone: d.phone, email: d.email, address: d.address, city: d.city, state: d.state, country: d.country, pincode: d.pincode, onboardingStep: 4 });
      else if (step === 4) await patch("/api/restaurant", skip ? { onboardingStep: 5 } : { latitude: num(d.latitude), longitude: num(d.longitude), onboardingStep: 5 });
      else if (step === 5) await patch("/api/restaurant", { settings: { paymentTiming: d.paymentTiming }, onboardingStep: 6 });
      else if (step === 6) await patch("/api/restaurant", { settings: { fees: { mode: d.feeMode } }, onboardingStep: 7 });
      else if (step === 7) { await patch("/api/restaurant", { onboardingDone: true }); router.replace("/dashboard"); return; }
      setStep(step + 1);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  function locate() {
    setGeoMsg("");
    if (!("geolocation" in navigator)) return setGeoMsg("Your browser doesn’t support location.");
    navigator.geolocation.getCurrentPosition(
      (p) => { set("latitude", Number(p.coords.latitude.toFixed(6))); set("longitude", Number(p.coords.longitude.toFixed(6))); },
      (e) => setGeoMsg(e.code === 1 ? "Location permission denied. Enter coordinates manually." : e.code === 3 ? "Timed out finding your location." : "Location unavailable."),
      { timeout: 10000, enableHighAccuracy: true },
    );
  }

  const lat = num(d.latitude), lng = num(d.longitude);
  const titles = ["Name your business", "What kind of business?", "Business information", "Where are you located?", "When do customers pay?", "Platform fee mode", "Launch your workspace"];
  const choice = (active: boolean) => cx("flex w-full items-start gap-3 rounded-xl border p-4 text-left transition", active ? "border-accent bg-accent/10" : "border-line hover:bg-surface2");

  return (
    <div className="relative grid min-h-screen place-items-center px-4 py-10">
      <div className="grid-bg absolute inset-0" aria-hidden />
      <div className="relative w-full max-w-xl">
        <div className="mb-6 flex justify-center"><Logo /></div>
        <div className="mb-4 flex gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={7} aria-valuenow={step}>{Array.from({ length: 7 }).map((_, i) => <div key={i} className={cx("h-1.5 flex-1 rounded-full", i < step ? "bg-accent" : "bg-surface2")} />)}</div>
        <Card className="anim-fade p-7">
          <p className="text-xs text-muted">Step {step} of 7</p>
          <h1 className="font-display mt-1 text-2xl font-semibold">{titles[step - 1]}</h1>
          <div className="mt-5 space-y-4">
            {err && <Notice tone="bad">{err}</Notice>}
            {step === 1 && <Field label="Business name"><Input autoFocus value={d.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Blue Door Cafe" /></Field>}
            {step === 2 && <div className="grid grid-cols-2 gap-3">{TYPES.map(([v, l, Icon]) => <button key={v} onClick={() => set("businessType", v)} className={choice(d.businessType === v)}><Icon className="size-5 text-accent" /><span className="font-medium">{l}</span></button>)}</div>}
            {step === 3 && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Phone"><Input value={d.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
                <Field label="Email"><Input type="email" value={d.email} onChange={(e) => set("email", e.target.value)} /></Field>
                <Field label="Address" className="sm:col-span-2"><Input value={d.address} onChange={(e) => set("address", e.target.value)} /></Field>
                <Field label="City"><Input value={d.city} onChange={(e) => set("city", e.target.value)} /></Field>
                <Field label="State"><Input value={d.state} onChange={(e) => set("state", e.target.value)} /></Field>
                <Field label="Country"><Input value={d.country} onChange={(e) => set("country", e.target.value)} /></Field>
                <Field label="Pincode"><Input value={d.pincode} onChange={(e) => set("pincode", e.target.value)} /></Field>
              </div>
            )}
            {step === 4 && (
              <div className="space-y-4">
                <Button variant="secondary" onClick={locate}><MapPin className="size-4" />Use my current location</Button>
                {geoMsg && <Notice tone="warn">{geoMsg}</Notice>}
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Latitude"><Input type="number" step="any" value={d.latitude} onChange={(e) => set("latitude", e.target.value)} /></Field>
                  <Field label="Longitude"><Input type="number" step="any" value={d.longitude} onChange={(e) => set("longitude", e.target.value)} /></Field>
                </div>
                {lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (
                  <iframe title="Location map" className="h-48 w-full rounded-xl border border-line" loading="lazy" src={`https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.004}%2C${lat - 0.003}%2C${lng + 0.004}%2C${lat + 0.003}&layer=mapnik&marker=${lat}%2C${lng}`} />
                )}
                <p className="text-xs text-muted">Used for the optional ordering geofence. You can change it later in Settings → Security.</p>
              </div>
            )}
            {step === 5 && <div className="space-y-3">
              <button onClick={() => set("paymentTiming", "PAY_AT_END")} className={choice(d.paymentTiming === "PAY_AT_END")}><CreditCard className="mt-0.5 size-5 text-accent" /><div><p className="font-medium">Pay at end</p><p className="text-sm text-muted">Guests order first and pay after their meal. Orders go straight to your team.</p></div></button>
              <button onClick={() => set("paymentTiming", "PAY_FIRST")} className={choice(d.paymentTiming === "PAY_FIRST")}><CreditCard className="mt-0.5 size-5 text-accent" /><div><p className="font-medium">Pay first</p><p className="text-sm text-muted">Orders are held until payment is confirmed before the kitchen can start.</p></div></button>
            </div>}
            {step === 6 && <div className="space-y-3">
              <button onClick={() => set("feeMode", "CUSTOMER_BASED")} className={choice(d.feeMode === "CUSTOMER_BASED")}><Building2 className="mt-0.5 size-5 text-accent" /><div><p className="font-medium">Customer based</p><p className="text-sm text-muted">The per-order platform fee is shown to the customer as a separate line.</p></div></button>
              <button onClick={() => set("feeMode", "STORE_BASED")} className={choice(d.feeMode === "STORE_BASED")}><Store className="mt-0.5 size-5 text-accent" /><div><p className="font-medium">Store based</p><p className="text-sm text-muted">Customers pay nothing extra; your usage balance records the fee.</p></div></button>
            </div>}
            {step === 7 && <div className="rounded-xl bg-surface2 p-5 text-center"><Rocket className="mx-auto size-8 text-accent" /><p className="mt-3 font-medium">{d.name} is ready</p><p className="mt-1 text-sm text-muted">Next: add your menu, create tables and print your QR codes.</p></div>}
          </div>
          <div className="mt-7 flex items-center justify-between">
            <Button variant="ghost" disabled={step <= 2 || busy} onClick={() => setStep(step - 1)}>Back</Button>
            <div className="flex gap-2">
              {(step === 3 || step === 4) && <Button variant="ghost" onClick={() => next(true)} disabled={busy}>Skip</Button>}
              <Button loading={busy} onClick={() => next()}>{step === 7 ? "Launch workspace" : "Continue"}</Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
