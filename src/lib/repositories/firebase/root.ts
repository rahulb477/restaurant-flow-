import type { Firestore } from "firebase-admin/firestore";
import { ApiError } from "@/lib/server/http";
import { ROOT, decode, encode, runTx } from "@/lib/firebase/firestore";
import type { PublicLookupRepository, RestaurantRepository, UserRepository } from "../interfaces";
import type { Restaurant, Tx, UserProfile } from "../types";

export class FirebaseRestaurantRepository implements RestaurantRepository {
  constructor(private db: Firestore) {}

  async get(id: string, tx?: Tx): Promise<Restaurant | null> {
    const ref = this.db.collection(ROOT.restaurants).doc(id);
    const snap = tx ? await tx.get(ref) : await ref.get();
    return snap.exists ? decode<Restaurant>(snap.id, snap.data()) : null;
  }

  async slugExists(slug: string): Promise<boolean> {
    return (await this.db.collection(ROOT.slugs).doc(slug).get()).exists;
  }

  async createWithOwner(input: Parameters<RestaurantRepository["createWithOwner"]>[0]): Promise<Restaurant> {
    const ref = this.db.collection(ROOT.restaurants).doc();
    const slugRef = this.db.collection(ROOT.slugs).doc(input.slug);
    const userRef = this.db.collection(ROOT.users).doc(input.owner.id);
    const now = new Date();
    const restaurant: Omit<Restaurant, "id"> = { ...input.data, slug: input.slug, ownerId: input.owner.id, createdAt: now, updatedAt: now };
    await runTx(this.db, async (tx) => {
      const [slugSnap, userSnap] = await Promise.all([tx.get(slugRef), tx.get(userRef)]);
      if (slugSnap.exists) throw new ApiError("That restaurant URL is already taken.", 409, "SLUG_TAKEN");
      const ids = ((userSnap.data()?.restaurantIds as string[] | undefined) ?? []).concat(ref.id);
      tx.create(slugRef, { restaurantId: ref.id, createdAt: now });
      tx.create(ref, encode(restaurant));
      tx.create(ref.collection("members").doc(input.owner.id), encode({ userId: input.owner.id, restaurantId: ref.id, role: "OWNER", status: "ACTIVE", name: input.owner.name, email: input.owner.email, createdAt: now }));
      tx.create(ref.collection("system").doc("counters"), { orderSeq: 0, usageBalance: 0, usageOrders: 0 });
      tx.set(userRef, { email: input.owner.email, name: input.owner.name, restaurantIds: ids, createdAt: userSnap.data()?.createdAt ?? now }, { merge: true });
    });
    return { ...restaurant, id: ref.id };
  }

  async update(id: string, patch: Partial<Restaurant>, tx?: Tx): Promise<void> {
    const ref = this.db.collection(ROOT.restaurants).doc(id);
    const enc = encode({ ...patch, updatedAt: new Date() });
    if (tx) tx.update(ref, enc);
    else await ref.update(enc);
  }
}

export class FirebaseUserRepository implements UserRepository {
  constructor(private db: Firestore) {}
  private ref(uid: string) {
    return this.db.collection(ROOT.users).doc(uid);
  }
  async get(uid: string): Promise<UserProfile | null> {
    const s = await this.ref(uid).get();
    if (!s.exists) return null;
    const u = decode<UserProfile>(s.id, s.data());
    return { ...u, restaurantIds: u.restaurantIds ?? [] };
  }
  async ensure(uid: string, email: string, name: string): Promise<UserProfile> {
    const existing = await this.get(uid);
    if (existing) {
      if (name && !existing.name) await this.ref(uid).set({ name }, { merge: true });
      return { ...existing, name: existing.name || name };
    }
    const data = { email, name, restaurantIds: [] as string[], createdAt: new Date() };
    await this.ref(uid).set(data, { merge: true });
    return { id: uid, ...data };
  }
  async addRestaurant(uid: string, restaurantId: string, tx?: Tx): Promise<void> {
    const ref = this.ref(uid);
    const run = async (t: Tx) => {
      const s = await t.get(ref);
      const ids = new Set<string>((s.data()?.restaurantIds as string[] | undefined) ?? []);
      ids.add(restaurantId);
      t.set(ref, { restaurantIds: [...ids] }, { merge: true });
    };
    if (tx) await run(tx);
    else await runTx(this.db, run);
  }
}

export class FirebasePublicLookupRepository implements PublicLookupRepository {
  constructor(private db: Firestore) {}
  async resolveSlug(slug: string) {
    if (!/^[a-z0-9-]{1,60}$/.test(slug)) return null;
    const s = await this.db.collection(ROOT.slugs).doc(slug).get();
    return s.exists ? (s.data()!.restaurantId as string) : null;
  }
  async resolveQrToken(token: string) {
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(token)) return null;
    const s = await this.db.collection(ROOT.qrTokens).doc(token).get();
    return s.exists ? { restaurantId: s.data()!.restaurantId as string, tableId: s.data()!.tableId as string } : null;
  }
  async resolveOrderToken(token: string) {
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(token)) return null;
    const s = await this.db.collection(ROOT.publicOrders).doc(token).get();
    return s.exists ? { restaurantId: s.data()!.restaurantId as string, orderId: s.data()!.orderId as string } : null;
  }
}
