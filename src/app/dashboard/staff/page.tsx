"use client";
import { useState } from "react";
import { Copy, MailPlus, Trash2 } from "lucide-react";
import { del, patch, post, useApi } from "@/lib/client/api";
import { Button, ConfirmDialog, DataTable, EmptyState, ErrorState, Field, Input, ListSkeleton, Modal, Notice, PageHeader, Select, StatusBadge, useToast, Badge } from "@/components/ui";
import { RoleGate } from "@/components/shell";

type Data = { members: { id: string; userId: string; role: string; status: string; name: string; email: string }[]; pending: { id: string; email: string; role: string; expiresAt: string; emailedAt: string | null }[]; emailConfigured: boolean; selfUserId: string };
const ROLES = [["MANAGER", "Manager"], ["CASHIER", "Cashier"], ["KITCHEN", "Kitchen"], ["STAFF", "Staff"]];

export default function Page() {
  return <RoleGate module="staff"><Staff /></RoleGate>;
}

function Staff() {
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Data>("/api/staff");
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ email: "", role: "CASHIER" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<{ emailed: boolean; emailError: string | null; link?: string; email: string } | null>(null);
  const [rm, setRm] = useState<Data["members"][number] | null>(null);

  async function invite() {
    setErr(""); setBusy(true);
    try { const r = await post<{ emailed: boolean; emailError: string | null; link?: string }>("/api/staff", f); setResult({ ...r, email: f.email }); reload(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function update(id: string, body: object) {
    try { await patch(`/api/staff/${id}`, body); toast.success("Updated"); reload(); } catch (e) { toast.error((e as Error).message); }
  }
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (loading || !data) return <ListSkeleton />;
  return (
    <div>
      <PageHeader title="Staff" subtitle="Invite teammates and control what they can access." actions={<Button onClick={() => { setOpen(true); setResult(null); setErr(""); setF({ email: "", role: "CASHIER" }); }}><MailPlus className="size-4" />Invite staff</Button>} />
      {!data.emailConfigured && <div className="mb-5"><Notice tone="warn">Email isn’t configured on this server, so invitations can’t be emailed. After inviting, you’ll get a link to share manually.</Notice></div>}
      <h2 className="mb-3 font-semibold">Team</h2>
      <DataTable columns={[
        { key: "name", label: "Member", render: (m) => <div><p className="font-medium">{m.name || "—"}{m.userId === data.selfUserId && <span className="ml-2 text-xs text-muted">(you)</span>}</p><p className="text-xs text-muted">{m.email}</p></div> },
        { key: "role", label: "Role", render: (m) => m.role === "OWNER" || m.userId === data.selfUserId ? <Badge>{m.role.toLowerCase()}</Badge> : <Select aria-label={`Role for ${m.email}`} className="h-9 w-36" value={m.role} onChange={(e) => update(m.id, { role: e.target.value })}>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select> },
        { key: "status", label: "Status", render: (m) => <StatusBadge status={m.status} /> },
      ]} rows={data.members} actions={(m) => m.role === "OWNER" || m.userId === data.selfUserId ? null : <><Button size="sm" variant="secondary" onClick={() => update(m.id, { status: m.status === "ACTIVE" ? "DISABLED" : "ACTIVE" })}>{m.status === "ACTIVE" ? "Disable" : "Enable"}</Button><Button size="sm" variant="ghost" aria-label={`Remove ${m.email}`} onClick={() => setRm(m)}><Trash2 className="size-4 text-bad" /></Button></>} />
      <h2 className="mb-3 mt-8 font-semibold">Pending invitations</h2>
      {!data.pending.length ? <EmptyState title="No pending invitations" text="Invite a cashier, kitchen staff or manager to get started." /> : (
        <DataTable columns={[{ key: "email", label: "Email" }, { key: "role", label: "Role", render: (p) => <Badge>{p.role.toLowerCase()}</Badge> }, { key: "emailedAt", label: "Email", render: (p) => (p.emailedAt ? "Sent" : "Not sent") }, { key: "expiresAt", label: "Expires", render: (p) => new Date(p.expiresAt).toLocaleDateString() }]} rows={data.pending}
          actions={(p) => <Button size="sm" variant="ghost" onClick={async () => { try { await del(`/api/staff/${p.id}?type=invite`); toast.success("Invitation revoked"); reload(); } catch (e) { toast.error((e as Error).message); } }}>Revoke</Button>} />
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Invite staff" footer={result ? <Button onClick={() => setOpen(false)}>Done</Button> : <><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} onClick={invite}>Send invitation</Button></>}>
        {result ? (
          <div className="space-y-3">
            {result.emailed ? <Notice tone="ok">Invitation emailed to {result.email}.</Notice> : <Notice tone="warn">Invitation created but the email was not sent{result.emailError ? `: ${result.emailError}` : ""}. Share this link with {result.email} (valid 7 days):</Notice>}
            {result.link && <div className="flex gap-2"><Input readOnly value={result.link} onFocus={(e) => e.target.select()} /><Button variant="secondary" aria-label="Copy link" onClick={() => { navigator.clipboard.writeText(result.link!).then(() => toast.success("Link copied")).catch(() => toast.error("Copy failed")); }}><Copy className="size-4" /></Button></div>}
          </div>
        ) : (
          <div className="space-y-4">{err && <Notice tone="bad">{err}</Notice>}
            <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="teammate@example.com" /></Field>
            <Field label="Role" hint="Manager: menu, inventory, promotions, analytics · Cashier: POS, orders, bills · Kitchen: KDS · Staff: POS, orders"><Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field></div>
        )}
      </Modal>
      <ConfirmDialog open={!!rm} onClose={() => setRm(null)} danger confirmLabel="Remove" title="Remove team member?" message={rm ? `${rm.email} will lose access immediately.` : ""} onConfirm={async () => { if (!rm) return; try { await del(`/api/staff/${rm.id}`); toast.success("Member removed"); reload(); } catch (e) { toast.error((e as Error).message); } setRm(null); }} />
    </div>
  );
}
