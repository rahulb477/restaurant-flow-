import type { CollectionReference, DocumentData, DocumentReference, Firestore, OrderByDirection, WhereFilterOp } from "firebase-admin/firestore";
import { decode, encode } from "@/lib/firebase/firestore";
import type { Tx } from "../types";

export type Where = [field: string, op: WhereFilterOp, value: unknown];
export type ListOptions = { where?: Where[]; orderBy?: [field: string, dir?: OrderByDirection][]; limit?: number };

/** Generic typed collection access with optional transaction participation. Subclassed by every Firebase repository. */
export class FirestoreCollection<T extends { id: string }> {
  constructor(
    protected readonly db: Firestore,
    protected readonly path: string,
  ) {}

  col(): CollectionReference<DocumentData> {
    return this.db.collection(this.path);
  }
  ref(id: string): DocumentReference<DocumentData> {
    return this.db.collection(this.path).doc(id);
  }
  newId() {
    return this.col().doc().id;
  }

  async get(id: string, tx?: Tx): Promise<T | null> {
    const ref = this.ref(id);
    const snap = tx ? await tx.get(ref) : await ref.get();
    return snap.exists ? decode<T>(snap.id, snap.data()) : null;
  }

  async getMany(ids: string[], tx?: Tx): Promise<T[]> {
    const uniq = Array.from(new Set(ids.filter(Boolean)));
    if (!uniq.length) return [];
    const refs = uniq.map((i) => this.ref(i));
    const snaps = tx ? await tx.getAll(...refs) : await this.db.getAll(...refs);
    return snaps.filter((s) => s.exists).map((s) => decode<T>(s.id, s.data()));
  }

  async list(opts: ListOptions = {}, tx?: Tx): Promise<T[]> {
    let q: FirebaseFirestore.Query<DocumentData> = this.col();
    for (const [f, op, v] of opts.where ?? []) q = q.where(f, op, v);
    for (const [f, d] of opts.orderBy ?? []) q = q.orderBy(f, d ?? "asc");
    if (opts.limit) q = q.limit(opts.limit);
    const snap = tx ? await tx.get(q) : await q.get();
    return snap.docs.map((d) => decode<T>(d.id, d.data()));
  }

  async count(opts: { where?: Where[] } = {}): Promise<number> {
    let q: FirebaseFirestore.Query<DocumentData> = this.col();
    for (const [f, op, v] of opts.where ?? []) q = q.where(f, op, v);
    const r = await q.count().get();
    return r.data().count;
  }

  /** Creates a new document; fails if the id already exists (used for idempotency guarantees). */
  async create(id: string | null, data: Omit<T, "id">, tx?: Tx): Promise<T> {
    const ref = id ? this.ref(id) : this.col().doc();
    const enc = encode(data);
    if (tx) tx.create(ref, enc);
    else await ref.create(enc);
    return { ...(data as object), id: ref.id } as T;
  }

  async set(id: string, data: Omit<T, "id">, tx?: Tx): Promise<void> {
    const ref = this.ref(id);
    if (tx) tx.set(ref, encode(data));
    else await ref.set(encode(data));
  }

  async update(id: string, patch: Partial<Omit<T, "id">>, tx?: Tx): Promise<void> {
    const ref = this.ref(id);
    const enc = encode(patch);
    if (tx) tx.update(ref, enc);
    else await ref.update(enc);
  }

  async remove(id: string, tx?: Tx): Promise<void> {
    const ref = this.ref(id);
    if (tx) tx.delete(ref);
    else await ref.delete();
  }
}
