# Database schema (PostgreSQL / Drizzle — `src/db/schema.ts`)
Identity: `users`, `sessions`, `auth_tokens`. Tenancy: `restaurants` (slug, settings JSONB, order sequence), `members` (role, status), `invitations`.
Menu: `categories`, `products`, `variant_groups` (options JSONB), `addons`. Inventory: `ingredients`, `recipes`, `inventory_transactions` (unique `(order_id, ingredient_id, type)` = idempotent deduction).
Operations: `dining_tables` (unique `qr_token`), `orders` (unique `(restaurant_id, idempotency_key)`, line items JSONB snapshot), `payments`, `bills`, `customers`.
Promotions: `coupons`, `coupon_redemptions`, `loyalty_programs`, `loyalty_rewards` (unique `(customer_id, milestone)`), `scratch_campaigns`, `scratch_issuances` (unique per order).
Billing: `usage_ledger` (unique per order), `settlements`. Misc: `reviews`, `activity_logs` (before/after), `notifications` (dedupe key), `files` (uploaded images).
Every tenant table carries `restaurant_id`; all queries filter by the session's restaurant.
