import { randomToken, sha256 } from "../auth";

/**
 * Invitation tokens are self-locating: `${restaurantId}.${staffId}.${secret}`. Only sha256(secret) is stored,
 * so a database leak does not leak usable invitations, and lookup is a direct document read (no cross-tenant query).
 */
export function newInviteToken(restaurantId: string, staffId: string) {
  const secret = randomToken(24);
  return { token: `${restaurantId}.${staffId}.${secret}`, tokenHash: sha256(secret) };
}

export function parseInviteToken(token: string): { restaurantId: string; staffId: string; secret: string } | null {
  const [restaurantId, staffId, secret, ...rest] = token.split(".");
  if (rest.length || !restaurantId || !staffId || !secret) return null;
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(restaurantId) || !/^[A-Za-z0-9_-]{4,64}$/.test(staffId) || !/^[a-f0-9]{16,128}$/.test(secret)) return null;
  return { restaurantId, staffId, secret };
}
