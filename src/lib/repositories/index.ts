import type { Firestore } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { runTx } from "@/lib/firebase/firestore";
import type { Repositories, TenantRepositories } from "./interfaces";
import { FirebasePublicLookupRepository, FirebaseRestaurantRepository, FirebaseUserRepository } from "./firebase/root";
import * as T from "./firebase/tenant";

export type { Repositories, TenantRepositories } from "./interfaces";
export * from "./types";

export function createRepositories(db: Firestore): Repositories {
  return {
    restaurants: new FirebaseRestaurantRepository(db),
    users: new FirebaseUserRepository(db),
    lookup: new FirebasePublicLookupRepository(db),
    transaction: (fn) => runTx(db, fn),
    tenant(rid: string): TenantRepositories {
      if (!rid || rid.includes("/")) throw new Error("Invalid restaurant id");
      return {
        restaurantId: rid,
        members: new T.FirebaseMembershipRepository(db, rid),
        staff: new T.FirebaseStaffRepository(db, rid),
        categories: new T.FirebaseCategoryRepository(db, rid),
        products: new T.FirebaseProductRepository(db, rid),
        variantGroups: new T.FirebaseVariantRepository(db, rid),
        addons: new T.FirebaseAddonRepository(db, rid),
        ingredients: new T.FirebaseIngredientRepository(db, rid),
        recipes: new T.FirebaseRecipeRepository(db, rid),
        inventoryTransactions: new T.FirebaseInventoryTransactionRepository(db, rid),
        tables: new T.FirebaseTableRepository(db, rid),
        customers: new T.FirebaseCustomerRepository(db, rid),
        orders: new T.FirebaseOrderRepository(db, rid),
        payments: new T.FirebasePaymentRepository(db, rid),
        bills: new T.FirebaseBillRepository(db, rid),
        coupons: new T.FirebaseCouponRepository(db, rid),
        loyalty: new T.FirebaseLoyaltyRepository(db, rid),
        scratchCampaigns: new T.FirebaseScratchCampaignRepository(db, rid),
        scratchCards: new T.FirebaseScratchCardRepository(db, rid),
        usage: new T.FirebaseUsageRepository(db, rid),
        settlements: new T.FirebaseSettlementRepository(db, rid),
        reviews: new T.FirebaseReviewRepository(db, rid),
        activityLogs: new T.FirebaseActivityLogRepository(db, rid),
        notifications: new T.FirebaseNotificationRepository(db, rid),
        analytics: new T.FirebaseAnalyticsRepository(db, rid),
      };
    },
  };
}

/** Repositories bound to the configured Firebase project (Admin SDK). */
export const repos = (): Repositories => createRepositories(getAdminDb());
export const tenantRepos = (restaurantId: string): TenantRepositories => repos().tenant(restaurantId);
