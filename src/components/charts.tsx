"use client";
import { useId, useState } from "react";

const PALETTE = ["#f59e0b", "#60a5fa", "#34d399", "#f472b6", "#a78bfa", "#fb923c", "#22d3ee"];

export function LineChart({ data, format = (n: number) => String(n), height = 180, color = "#f59e0b" }: { data: { label: string; value: number }[]; format?: (n: number) => string; height?: number; color?: string }) {
  const gid = useId();
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return null;
  const W = 600, H = height, P = 24;
  const max = Math.max(...data.map((d) => d.value), 1);
  const x = (i: number) => P + (data.length === 1 ? (W - 2 * P) / 2 : (i * (W - 2 * P)) / (data.length - 1));
  const y = (v: number) => H - P - (v / max) * (H - 2 * P);
  const path = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ");
  const area = `${path} L${x(data.length - 1)},${H - P} L${x(0)},${H - P} Z`;
  const step = Math.ceil(data.length / 7);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Trend chart" onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((t) => <line key={t} x1={P} x2={W - P} y1={H - P - t * (H - 2 * P)} y2={H - P - t * (H - 2 * P)} stroke="#2a2a30" strokeDasharray="3 4" />)}
        <path d={area} fill={`url(#${gid})`} />
        <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => (
          <g key={i}>
            <rect x={x(i) - 12} y={0} width={24} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} />
            {(hover === i || data.length <= 14) && <circle cx={x(i)} cy={y(d.value)} r={hover === i ? 5 : 3} fill={color} />}
            {i % step === 0 && <text x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="#9a9aa5">{d.label}</text>}
          </g>
        ))}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute left-2 top-0 rounded-md bg-surface2 px-2 py-1 text-xs shadow">
          {data[hover].label}: <b>{format(data[hover].value)}</b>
        </div>
      )}
    </div>
  );
}

export function BarList({ items, format = (n: number) => String(n), empty = "No data for this period" }: { items: { label: string; value: number; sub?: string }[]; format?: (n: number) => string; empty?: string }) {
  if (!items.length) return <p className="py-6 text-center text-sm text-muted">{empty}</p>;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="space-y-3">
      {items.map((i, idx) => (
        <li key={i.label}>
          <div className="mb-1 flex justify-between text-sm"><span className="truncate pr-2">{i.label}{i.sub && <span className="ml-2 text-xs text-muted">{i.sub}</span>}</span><span className="tabular-nums text-muted">{format(i.value)}</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-surface2"><div className="h-full rounded-full" style={{ width: `${(i.value / max) * 100}%`, background: PALETTE[idx % PALETTE.length] }} /></div>
        </li>
      ))}
    </ul>
  );
}

export function Donut({ items, format = (n: number) => String(n), empty = "No data for this period" }: { items: { label: string; value: number }[]; format?: (n: number) => string; empty?: string }) {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (!total) return <p className="py-6 text-center text-sm text-muted">{empty}</p>;
  let acc = 0;
  const R = 52, C = 2 * Math.PI * R;
  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 140 140" className="size-32 shrink-0 -rotate-90" role="img" aria-label="Distribution chart">
        {items.map((i, idx) => {
          const len = (i.value / total) * C;
          const el = <circle key={i.label} cx="70" cy="70" r={R} fill="none" stroke={PALETTE[idx % PALETTE.length]} strokeWidth="18" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} />;
          acc += len;
          return el;
        })}
      </svg>
      <ul className="space-y-1.5 text-sm">
        {items.map((i, idx) => (
          <li key={i.label} className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: PALETTE[idx % PALETTE.length] }} />{i.label}<span className="text-muted">{format(i.value)}</span></li>
        ))}
      </ul>
    </div>
  );
}

export function HourBars({ data }: { data: { hour: number; orders: number }[] }) {
  const max = Math.max(...data.map((d) => d.orders), 1);
  return (
    <div>
      <div className="flex h-32 items-end gap-1" role="img" aria-label="Orders by hour">
        {data.map((d) => (
          <div key={d.hour} className="group relative flex-1">
            <div className="rounded-t bg-accent/80 transition group-hover:bg-accent" style={{ height: `${Math.max((d.orders / max) * 100, d.orders ? 6 : 2)}%`, opacity: d.orders ? 1 : 0.2 }} />
            <span className="pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 rounded bg-surface2 px-1.5 py-0.5 text-[10px] group-hover:block">{d.orders}</span>
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted"><span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span></div>
    </div>
  );
}
