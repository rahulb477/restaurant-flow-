"use client";
import { Badge, Notice, PageHeader } from "@/components/ui";
import { CrudManager } from "@/components/crud";
import { RoleGate } from "@/components/shell";

export default function Page() {
  return <RoleGate module="scratch"><Scratch /></RoleGate>;
}

function Scratch() {
  return (
    <div>
      <PageHeader title="Scratch cards" subtitle="Customers receive a scratch card after a completed order. Winners are chosen on the server — never in the browser." />
      <div className="mb-5"><Notice tone="info">Probabilities are percentages. Anything left over (100% − total) means “no reward”. Each order can reveal and claim its card only once.</Notice></div>
      <CrudManager resource="scratch-campaigns" singular="Campaign" plural="Campaigns" searchable={false}
        fields={[{ key: "name", label: "Campaign name", type: "text", required: true }, { key: "startsAt", label: "Starts", type: "datetime" }, { key: "endsAt", label: "Ends", type: "datetime" }, { key: "usageLimit", label: "Max reveals", type: "number", hint: "0 = unlimited" }, { key: "rewards", label: "Rewards & probability", type: "rewards" }, { key: "isActive", label: "Active", type: "boolean" }]}
        defaults={{ name: "", startsAt: "", endsAt: "", usageLimit: 0, rewards: [{ label: "Free cookie", probability: 10 }], isActive: true }}
        emptyText="Create a campaign with rewards like “Free cookie — 10%”." deleteMessage={(r) => `Delete campaign “${r.name}”? Already-issued cards remain.`}
        columns={[
          { key: "name", label: "Campaign", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "rewards", label: "Rewards", render: (r) => (r.rewards as { label: string; probability: number }[]).map((x) => `${x.label} (${x.probability}%)`).join(", ") },
          { key: "usedCount", label: "Revealed", render: (r) => `${r.usedCount}${r.usageLimit ? ` / ${r.usageLimit}` : ""}` },
          { key: "endsAt", label: "Window", render: (r) => (r.startsAt || r.endsAt ? `${r.startsAt ? new Date(r.startsAt).toLocaleDateString() : "…"} → ${r.endsAt ? new Date(r.endsAt).toLocaleDateString() : "…"}` : "Always on") },
          { key: "isActive", label: "Status", render: (r) => <Badge className={r.isActive ? "bg-ok/15 text-ok" : "bg-white/10 text-muted"}>{r.isActive ? "Active" : "Inactive"}</Badge> },
        ]} />
    </div>
  );
}
