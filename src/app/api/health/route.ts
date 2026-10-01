import { getAdminDb } from "@/lib/firebase/admin";

export const dynamic = "force-dynamic";

/** Liveness + Firestore reachability. Reveals nothing about configuration. */
export async function GET() {
  try {
    await getAdminDb().collection("slugs").doc("__health__").get();
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
