# Firebase notes
This build runs on PostgreSQL (see README). No Firebase credentials were present in `.env`, and none were invented. To port to Firebase later:
- **Auth:** replace `src/lib/server/auth.ts` sessions with Firebase Auth + session cookies (Admin SDK `createSessionCookie`); keep membership as `restaurants/{id}/members/{uid}`.
- **Firestore:** map each table in `DATABASE_SCHEMA.md` to `restaurants/{restaurantId}/<collection>`. Re-implement `orders` and `deductInventory` as Admin-SDK transactions or Cloud Functions (idempotency keys → document IDs).
- **Rules:** deny client writes for orders, payments, usage, inventory and roles; allow reads only where `request.auth.uid` has a member doc for that restaurant; public menu reads via a server endpoint.
- **Storage:** replace the `files` table with `restaurants/{id}/products|logo|menu` and size/content-type rules.
- **Indexes:** orders by `(status, createdAt)` and `(createdAt)`, activity logs, usage and settlements by `createdAt`.
- Add authorised domains in Firebase Console → Authentication → Settings. Never commit service-account JSON.
