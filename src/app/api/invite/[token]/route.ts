import { getAdminAuth } from "@/lib/firebase/admin";
import { api, ApiError, rateLimit, clientIp } from "@/lib/server/http";
import { sha256 } from "@/lib/server/auth";
import { repos } from "@/lib/repositories";
import { parseInviteToken } from "@/lib/server/services/staff";

export const GET = api<{ token: string }>(async (req, { token }) => {
  rateLimit(`invinfo:${clientIp(req)}`, 60, 600_000);
  const parsed = parseInviteToken(token);
  const invalid = new ApiError("This invitation is invalid or has expired.", 404, "TOKEN_INVALID");
  if (!parsed) throw invalid;
  const R = repos();
  const inv = await R.tenant(parsed.restaurantId).staff.get(parsed.staffId);
  if (!inv || inv.status !== "PENDING" || inv.expiresAt < new Date() || inv.tokenHash !== sha256(parsed.secret)) throw invalid;
  const rest = await R.restaurants.get(parsed.restaurantId);
  const existing = !!(await getAdminAuth().getUserByEmail(inv.email).catch(() => null));
  return { email: inv.email, role: inv.role, restaurant: rest?.name ?? "", existingAccount: existing };
});
