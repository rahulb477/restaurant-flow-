"use client";
import Link from "next/link";
import { Star } from "lucide-react";
import { useApi } from "@/lib/client/api";
import { Card, EmptyState, ErrorState, ListSkeleton, Notice, PageHeader } from "@/components/ui";
import { RoleGate } from "@/components/shell";

type Data = { items: { id: string; rating: number; text: string; displayId: string; customer: string; createdAt: string }[]; average: number; googleReviewUrl: string };

export default function Page() {
  return <RoleGate module="reviews"><Reviews /></RoleGate>;
}

function Reviews() {
  const { data, error, loading, reload } = useApi<Data>("/api/dash/reviews", { poll: 30000 });
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (loading || !data) return <ListSkeleton />;
  return (
    <div>
      <PageHeader title="Google reviews" subtitle="After a completed order, guests rate their visit, get an AI-drafted review, copy it and post on Google themselves." />
      {!data.googleReviewUrl && <div className="mb-5"><Notice tone="warn">No Google review link is set, so guests can’t be sent to Google. Add it in <Link href="/dashboard/settings?tab=ordering" className="underline">Settings → Ordering</Link>.</Notice></div>}
      <Card className="mb-6 flex items-center gap-6 p-5"><div><p className="text-xs text-muted">Average rating</p><p className="text-3xl font-semibold">{data.items.length ? data.average.toFixed(1) : "—"}</p></div><div className="text-sm text-muted">{data.items.length} guest rating{data.items.length === 1 ? "" : "s"}</div></Card>
      {!data.items.length ? <EmptyState icon={<Star className="size-5" />} title="No reviews yet" text="Ratings appear here after customers complete an order and open their order page." /> : (
        <ul className="space-y-3">{data.items.map((r) => (
          <li key={r.id}><Card className="p-4"><div className="flex items-center justify-between"><div className="flex gap-0.5" aria-label={`${r.rating} out of 5`}>{[1, 2, 3, 4, 5].map((n) => <Star key={n} className={`size-4 ${n <= r.rating ? "fill-accent text-accent" : "text-muted"}`} />)}</div><span className="text-xs text-muted">{r.displayId} · {new Date(r.createdAt).toLocaleDateString()}</span></div>{r.text && <p className="mt-2 text-sm text-muted">{r.text}</p>}</Card></li>
        ))}</ul>
      )}
    </div>
  );
}
