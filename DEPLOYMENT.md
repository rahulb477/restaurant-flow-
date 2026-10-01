# Deployment
1. Provision Postgres and set `DATABASE_URL`, `NEXT_PUBLIC_APP_URL` (public https URL), `NEXT_PUBLIC_DEMO_MODE=false`.
2. `npx drizzle-kit push --config drizzle.config.json` (or generate/apply migrations).
3. Optional integrations: email, AI, payments, platform UPI/admin secret, WhatsApp support number (see README).
4. `npm run build && npm start` behind HTTPS (the session cookie is `secure` when `x-forwarded-proto=https`).
5. Health check: `GET /api/health`.
6. Confirm a settlement as the platform operator: `POST /api/admin/settlements/{id}` with header `x-admin-secret` and body `{"status":"PAID"|"FAILED"}`.
Checklist: demo mode off · HTTPS · backups · email provider set · app URL set.
