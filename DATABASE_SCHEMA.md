# Firestore data model

Cloud Firestore is the only database. Money is stored as integer minor units (paise). Dates are Firestore Timestamps (the repositories convert to/from `Date`). Types live in `src/lib/repositories/types.ts`; the Firebase implementations in `src/lib/repositories/firebase/`.

## Root collections
| Path | Purpose | Client access |
|---|---|---|
| `users/{uid}` | profile: email, name, `restaurantIds[]` — **no password or hash** (credentials live in Firebase Auth) | owner of the doc: `get` |
| `slugs/{slug}` | slug → `restaurantId` (reserved transactionally; guarantees uniqueness) | none (server) |
| `qrTokens/{token}` | QR token → `{restaurantId, tableId}` (global uniqueness) | none (server) |
| `publicOrders/{token}` | sanitized order projection for customer tracking | `get` by token only; no list |
| `restaurants/{rid}` | profile + `settings` (fee mode, UPI id, geofence, tax, payment toggles), `ownerId`, `loyaltyProgram` | active member: `get` |

## Tenant subcollections — `restaurants/{rid}/…`
| Collection | Document id | Notes | Read access |
|---|---|---|---|
| `members` | uid | `{role, status}` — the **source of truth** for access | self; OWNER lists |
| `staff` | auto | invitations: email, role, `tokenHash` (never the token), expiry, status | OWNER |
| `categories`, `products`, `variantGroups` (options embedded), `addons` | auto | menu | any active member |
| `ingredients` | auto | stock, threshold, unit, cost | OWNER, MANAGER |
| `recipes` | productId | `items[{ingredientId, quantity}]` | OWNER, MANAGER, KITCHEN |
| `inventoryTransactions` | `${orderId}_${ingredientId}_ORDER_DEDUCTION` for deductions | append-only history; `create` fails if present → idempotent | OWNER, MANAGER |
| `tables` | auto | `qrToken` stable, status FREE/OCCUPIED/RESERVED | OWNER, MANAGER, CASHIER, STAFF |
| `customers` | auto | contact details, visits, spend | OWNER, MANAGER |
| `orders` | deterministic from `(restaurantId, idempotencyKey)` | line snapshots, totals, status, paymentStatus | OWNER, MANAGER, CASHIER, STAFF |
| `payments` | auto | method, status `PENDING/PROCESSING/SUCCESS/FAILED/CANCELLED/REFUNDED`, providerRef, reference | OWNER, MANAGER, CASHIER |
| `bills` | orderId | invoice snapshot | OWNER, MANAGER, CASHIER |
| `kitchenTickets` | orderId | items + notes, no prices/contact | OWNER, MANAGER, KITCHEN |
| `coupons` (+ `redemptions/{orderId}`) | uppercase code | usage limit, validity | OWNER, MANAGER |
| `loyalty` | `${customerId}_${milestone}` | rewards (unique per milestone) | OWNER, MANAGER |
| `scratchCampaigns`, `scratchCards` | auto / orderId | reward chosen server-side at reveal | OWNER, MANAGER |
| `reviews` | orderId | rating/text (Google review is copy-and-open only) | OWNER, MANAGER |
| `usage` | orderId | platform-fee ledger: one row per order, `CHARGED → SETTLED` | OWNER |
| `settlements` | auto | `PENDING/PAID/FAILED`, amount, orderCount, reference | OWNER |
| `system/counters` | `counters` | `{orderSeq, usageBalance, usageOrders}` | OWNER |
| `activityLogs` | auto | actor, role, action, entity, before/after (secret-looking keys scrubbed) | OWNER |
| `notifications` | auto/deterministic | low stock, new order, usage alerts… | any active member |

## Writes
**No client may write to any Firestore document** (`allow write: if false` everywhere). All writes come from API routes with the Admin SDK, inside transactions where consistency matters (order creation + usage + coupon + counters; inventory deduction; settlement; loyalty/scratch issuance). Deterministic ids give idempotency (duplicate order submit, double deduction, double usage row, double reward all collide on `create`).

## Indexes
None required (`firestore.indexes.json` is empty). Queries are single-field, or equality plus a range on one field; a few filters run in memory over bounded result sets.

## Storage layout
`restaurants/{rid}/{logo|menu|products|scratch|qr|invoices}/{file}` — images only (PNG/JPEG/WebP), ≤ 5 MB, membership and role checked against Firestore (see `storage.rules`).
