# Deployment

CafePilot is a single Next.js 16 app (Node 20+). Firebase provides Auth, Firestore and Storage. Any Node host works (Firebase App Hosting, Cloud Run, Vercel, a VM).

## Checklist
1. **Firebase project** set up per [FIREBASE_SETUP.md](FIREBASE_SETUP.md): Email/Password enabled, Firestore + Storage created, authorized domain added.
2. **Deploy rules and indexes** before first traffic: `npm run firebase:deploy:rules`. Grant the Storage service agent Firestore read access (see FIREBASE_SETUP.md).
3. **Environment variables** — set on the host's secret manager (not in the repo): all `NEXT_PUBLIC_FIREBASE_*`, `NEXT_PUBLIC_APP_URL` (public HTTPS URL, used in invite/payment-return links), Firebase Admin credentials, `PLATFORM_FEE_MINOR`, `SETTLEMENT_THRESHOLD_MINOR`, `PLATFORM_UPI_ID`, `PLATFORM_ADMIN_SECRET`. Optional: payment, AI, email variables. `NEXT_PUBLIC_*` values are inlined **at build time** — set them before `npm run build`.
4. **Build and start:** `npm ci && npm run typecheck && npm run lint && npm test && npm run build && npm start`.
5. **Online payments (optional):** set `PAYMENT_PROVIDER` + keys; configure the provider webhook to `https://<your-domain>/api/payments/webhook` with the same secret as `PAYMENT_WEBHOOK_SECRET`.
6. **Health check:** `GET /api/health` (`{ok:true}` when Firestore is reachable, else 503; reveals no configuration).
7. **Smoke test:** sign up → verify e-mail → onboarding → add a product and table → open the QR link on a phone → place an order → watch it on `/dashboard/kds` → collect payment → complete.

## Operations
- Rate limiting is per instance; when scaling horizontally put a shared limiter (or the platform's WAF) in front of `/api/public/*` and `/api/auth/*`.
- Settlement confirmation is an operator action: `POST /api/admin/settlements/{id}` with header `x-admin-secret: <PLATFORM_ADMIN_SECRET>` and body `{restaurantId, status}`.
- Backups: enable Firestore scheduled backups / PITR in the Google Cloud console.
- Rotate the service-account key and `PLATFORM_ADMIN_SECRET` by updating host secrets and redeploying.
