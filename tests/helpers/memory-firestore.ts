/**
 * In-memory stand-in for the subset of the Firestore Admin API that the repositories use. It exists so that service-level
 * behaviour (order totals, idempotency, usage ledger, settlements, tenant isolation ...) can be tested without the Firestore
 * emulator (which needs Java). It deliberately mimics the semantics that matter for correctness:
 *
 *   - transactions: reads must precede writes (throws like Firestore), writes are buffered until commit, and commit
 *     aborts + retries when any document/collection that was read has changed (optimistic concurrency, like Firestore);
 *   - `create` fails with ALREADY_EXISTS (code 6), `update` on a missing doc with NOT_FOUND (code 5);
 *   - `undefined` fields are ignored (the app enables ignoreUndefinedProperties);
 *   - Dates round-trip as Firestore Timestamps (anything with `toDate()`), so the repo's decode path is exercised.
 *
 * It is NOT a substitute for the emulator-backed rules tests in tests/rules (which run only when an emulator is available).
 */
import type { Firestore } from "firebase-admin/firestore";

type Data = Record<string, unknown>;
export class FsError extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message);
  }
}

class FakeTimestamp {
  constructor(private ms: number) {}
  toDate() {
    return new Date(this.ms);
  }
  toMillis() {
    return this.ms;
  }
}

function enc(v: unknown): unknown {
  if (v instanceof Date) return new FakeTimestamp(v.getTime());
  if (Array.isArray(v)) return v.map(enc);
  if (v && typeof v === "object" && !(v instanceof FakeTimestamp)) {
    const out: Data = {};
    for (const [k, x] of Object.entries(v as Data)) if (x !== undefined) out[k] = enc(x);
    return out;
  }
  return v;
}
const cmpVal = (v: unknown): unknown => (v instanceof FakeTimestamp ? v.toMillis() : v instanceof Date ? v.getTime() : v);

type Doc = { data: Data; version: number };

export class MemoryFirestore {
  docs = new Map<string, Doc>();
  colVersion = new Map<string, number>();
  private seq = 0;
  /** Number of transaction attempts that were aborted due to contention (useful in concurrency tests). */
  aborts = 0;

  settings() {}
  collection(path: string) {
    return new CollRef(this, path);
  }
  doc(path: string) {
    const i = path.lastIndexOf("/");
    return new CollRef(this, path.slice(0, i)).doc(path.slice(i + 1));
  }
  newId() {
    return `auto${(++this.seq).toString(36).padStart(6, "0")}${Math.random().toString(36).slice(2, 10)}`;
  }
  async getAll(...refs: DocRef[]) {
    return refs.map((r) => r.snap());
  }
  batch() {
    const ops: (() => void)[] = [];
    const self = this;
    return {
      set(ref: DocRef, data: Data) {
        ops.push(() => self.write(ref.path, enc(data) as Data, "set"));
        return this;
      },
      update(ref: DocRef, data: Data) {
        ops.push(() => self.write(ref.path, enc(data) as Data, "update"));
        return this;
      },
      create(ref: DocRef, data: Data) {
        ops.push(() => self.write(ref.path, enc(data) as Data, "create"));
        return this;
      },
      delete(ref: DocRef) {
        ops.push(() => self.write(ref.path, null, "delete"));
        return this;
      },
      async commit() {
        ops.forEach((o) => o());
      },
    };
  }
  async runTransaction<T>(fn: (tx: MemTx) => Promise<T>, opts?: { maxAttempts?: number }): Promise<T> {
    const max = opts?.maxAttempts ?? 5;
    for (let attempt = 1; ; attempt++) {
      const tx = new MemTx(this);
      try {
        const out = await fn(tx);
        tx.commit();
        return out;
      } catch (e) {
        if (e instanceof FsError && e.code === 10 && attempt < max) {
          this.aborts++;
          continue;
        }
        throw e;
      }
    }
  }

  /** direct write used by commit / batch */
  write(path: string, data: Data | null, kind: "set" | "update" | "create" | "delete", merge = false) {
    const cur = this.docs.get(path);
    if (kind === "create" && cur) throw new FsError(6, `ALREADY_EXISTS: ${path}`);
    if (kind === "update" && !cur) throw new FsError(5, `NOT_FOUND: ${path}`);
    if (kind === "delete") this.docs.delete(path);
    else {
      const next = kind === "update" || merge ? { ...(cur?.data ?? {}), ...(data as Data) } : { ...(data as Data) };
      this.docs.set(path, { data: next, version: (cur?.version ?? 0) + 1 });
    }
    const col = path.slice(0, path.lastIndexOf("/"));
    this.colVersion.set(col, (this.colVersion.get(col) ?? 0) + 1);
  }

  /** test helpers */
  dump(prefix = "") {
    return Array.from(this.docs.entries()).filter(([p]) => p.startsWith(prefix)).map(([p, d]) => [p, d.data] as const);
  }
  asFirestore() {
    return this as unknown as Firestore;
  }
}

export class MemSnap {
  constructor(
    public ref: DocRef,
    private d: Data | null,
  ) {}
  get id() {
    return this.ref.id;
  }
  get exists() {
    return this.d !== null;
  }
  data() {
    return this.d ? structuredCloneish(this.d) : undefined;
  }
}
const structuredCloneish = (o: Data): Data => {
  const walk = (v: unknown): unknown => {
    if (v instanceof FakeTimestamp) return v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Data).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(o) as Data;
};

export class DocRef {
  constructor(
    private db: MemoryFirestore,
    public path: string,
  ) {}
  get id() {
    return this.path.slice(this.path.lastIndexOf("/") + 1);
  }
  collection(sub: string) {
    return new CollRef(this.db, `${this.path}/${sub}`);
  }
  snap() {
    const d = this.db.docs.get(this.path);
    return new MemSnap(this, d ? structuredCloneish(d.data) : null);
  }
  async get() {
    return this.snap();
  }
  async set(data: Data, opts?: { merge?: boolean }) {
    this.db.write(this.path, enc(data) as Data, "set", !!opts?.merge);
  }
  async create(data: Data) {
    this.db.write(this.path, enc(data) as Data, "create");
  }
  async update(data: Data) {
    this.db.write(this.path, enc(data) as Data, "update");
  }
  async delete() {
    this.db.write(this.path, null, "delete");
  }
}

type Filter = [string, string, unknown];
class Query {
  constructor(
    protected db: MemoryFirestore,
    public path: string,
    protected filters: Filter[] = [],
    protected orders: [string, "asc" | "desc"][] = [],
    protected lim = 0,
  ) {}
  where(f: string, op: string, v: unknown) {
    return new Query(this.db, this.path, [...this.filters, [f, op, v]], this.orders, this.lim);
  }
  orderBy(f: string, d: "asc" | "desc" = "asc") {
    return new Query(this.db, this.path, this.filters, [...this.orders, [f, d]], this.lim);
  }
  limit(n: number) {
    return new Query(this.db, this.path, this.filters, this.orders, n);
  }
  run() {
    const prefix = `${this.path}/`;
    let rows = Array.from(this.db.docs.entries()).filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"));
    for (const [f, op, v] of this.filters) {
      const want = cmpVal(v);
      rows = rows.filter(([, d]) => {
        const got = cmpVal(d.data[f]);
        switch (op) {
          case "==": return got === want;
          case "!=": return got !== want;
          case "<": return got !== undefined && (got as number) < (want as number);
          case "<=": return got !== undefined && (got as number) <= (want as number);
          case ">": return got !== undefined && (got as number) > (want as number);
          case ">=": return got !== undefined && (got as number) >= (want as number);
          case "in": return (want as unknown[]).includes(got);
          case "array-contains": return Array.isArray(d.data[f]) && (d.data[f] as unknown[]).includes(want);
          default: throw new Error(`memory-firestore: unsupported operator ${op}`);
        }
      });
    }
    for (const [f] of this.orders) rows = rows.filter(([, d]) => d.data[f] !== undefined); // Firestore drops docs lacking the order field
    rows.sort((a, b) => {
      for (const [f, dir] of this.orders) {
        const x = cmpVal(a[1].data[f]) as number, y = cmpVal(b[1].data[f]) as number;
        if (x === y) continue;
        return (x < y ? -1 : 1) * (dir === "asc" ? 1 : -1);
      }
      return 0;
    });
    if (this.lim) rows = rows.slice(0, this.lim);
    return rows.map(([p]) => new DocRef(this.db, p));
  }
  async get() {
    const docs = this.run().map((r) => r.snap());
    return { docs, size: docs.length, empty: !docs.length };
  }
  count() {
    return { get: async () => ({ data: () => ({ count: this.run().length }) }) };
  }
  version() {
    return this.db.colVersion.get(this.path) ?? 0;
  }
}

export class CollRef extends Query {
  constructor(db: MemoryFirestore, path: string) {
    super(db, path);
  }
  get id() {
    return this.path.slice(this.path.lastIndexOf("/") + 1);
  }
  doc(id?: string) {
    return new DocRef(this.db, `${this.path}/${id ?? this.db.newId()}`);
  }
}

export class MemTx {
  private reads = new Map<string, number>();
  private colReads = new Map<string, number>();
  private writes: (() => void)[] = [];
  private wrote = false;
  constructor(private db: MemoryFirestore) {}
  private assertReadable() {
    if (this.wrote) throw new Error("Firestore transactions require all reads to be executed before all writes.");
  }
  async get(target: DocRef | Query) {
    this.assertReadable();
    if (target instanceof DocRef) {
      this.reads.set(target.path, this.db.docs.get(target.path)?.version ?? 0);
      return target.snap();
    }
    const q = target as Query;
    this.colReads.set(q.path, q.version());
    return q.get();
  }
  async getAll(...refs: DocRef[]) {
    this.assertReadable();
    return refs.map((r) => {
      this.reads.set(r.path, this.db.docs.get(r.path)?.version ?? 0);
      return r.snap();
    });
  }
  set(ref: DocRef, data: Data, opts?: { merge?: boolean }) {
    this.wrote = true;
    this.writes.push(() => this.db.write(ref.path, enc(data) as Data, "set", !!opts?.merge));
    return this;
  }
  create(ref: DocRef, data: Data) {
    this.wrote = true;
    this.writes.push(() => this.db.write(ref.path, enc(data) as Data, "create"));
    return this;
  }
  update(ref: DocRef, data: Data) {
    this.wrote = true;
    this.writes.push(() => this.db.write(ref.path, enc(data) as Data, "update"));
    return this;
  }
  delete(ref: DocRef) {
    this.wrote = true;
    this.writes.push(() => this.db.write(ref.path, null, "delete"));
    return this;
  }
  commit() {
    for (const [p, v] of this.reads) if ((this.db.docs.get(p)?.version ?? 0) !== v) throw new FsError(10, "ABORTED: contention");
    for (const [p, v] of this.colReads) if ((this.db.colVersion.get(p) ?? 0) !== v) throw new FsError(10, "ABORTED: contention");
    // validate-then-apply: stage on a snapshot so a failing write (e.g. create on existing) leaves no partial commit
    const snapshot = new Map(Array.from(this.db.docs.entries()).map(([k, d]) => [k, { ...d }]));
    const cv = new Map(this.db.colVersion);
    try {
      this.writes.forEach((w) => w());
    } catch (e) {
      this.db.docs = snapshot;
      this.db.colVersion = cv;
      throw e;
    }
  }
}
