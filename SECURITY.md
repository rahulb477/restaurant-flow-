# Security
- **Tenant isolation:** the restaurant is derived from the signed-in user's active membership; every query includes `restaurant_id`. Public endpoints resolve by slug/QR token/order token only. (Verified: a second tenant gets 404 on another tenant's orders/products.)
- **Authorization:** `can(role, module)` matrix enforced in every API route (`requireCtx`). Owner role cannot be changed/removed; users cannot edit themselves; `restaurantId` is never accepted from request bodies (zod strips unknown keys).
- **Never trusted from the client:** prices, variants, add-ons, discounts, tax, fees, totals, payment status, inventory, loyalty, scratch rewards, roles.
- **Idempotency:** orders (`idempotencyKey`), inventory deduction (unique ledger key + `inventory_processed`), loyalty (`loyalty_processed` + milestone uniqueness), scratch (one card per order, atomic reveal/claim), usage fee (unique per order).
- **Payments:** a UPI link/QR never marks an order paid; staff confirm receipt. Online provider verification uses HMAC with timing-safe compare. Settlement confirmation requires `PLATFORM_ADMIN_SECRET`.
- **Privacy:** geofence location is used for a single distance check and not stored. Passwords hashed with scrypt; reset/verify tokens are hashed, single-use and expiring. Rate limits on auth and public endpoints.
- **Secrets:** read only from environment; server vars are never exposed (`NEXT_PUBLIC_` only for safe values); `.env*` is git-ignored; audit logs strip secret-like keys.
- Known limits: rate limiter is per-instance memory; for multi-instance deployments use a shared store.
