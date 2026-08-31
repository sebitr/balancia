import {
  ArrowLeftRight,
  Baby,
  BedDouble,
  CalendarDays,
  CircleParking,
  Coins,
  CreditCard,
  DoorOpen,
  Ellipsis,
  Film,
  Gift,
  GraduationCap,
  Heart,
  House,
  KeyRound,
  Landmark,
  Laptop,
  Package,
  PartyPopper,
  Percent,
  Plane,
  ReceiptText,
  ShieldCheck,
  Shirt,
  Tag,
  Utensils,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  INCOME_CATEGORIES,
  type IncomeCategory,
  type IncomeSubcategoryOf,
} from "@/modules/categorization";

/**
 * A glyph for every income code.
 *
 * Kept beside `category-icon.tsx` rather than inside it: the two vocabularies
 * share no codes and a single map keyed by both would have to be indexed by a
 * pair anyway. Exhaustive over the type, so a category added without a glyph
 * is a compile error rather than a blank chip.
 */
export const INCOME_CATEGORY_GLYPHS: Record<IncomeCategory, LucideIcon> = {
  rent: KeyRound,
  refunds: ArrowLeftRight,
  deposits: ShieldCheck,
  contributions: Coins,
  sales: Tag,
  earnings: Landmark,
  benefits: Heart,
  financial: Percent,
  other: Ellipsis,
};

/**
 * The second level, keyed by parent.
 *
 * `other` has no subcategories, so it is absent here — the type says as much,
 * and callers ask `getIncomeSubcategories` rather than assuming a key.
 */
export const INCOME_SUBCATEGORY_GLYPHS: {
  readonly [C in IncomeCategory]: {
    readonly [S in IncomeSubcategoryOf<C>]: LucideIcon;
  };
} = {
  rent: {
    monthly_rent: CalendarDays,
    parking: CircleParking,
    storage: Package,
    utilities_share: Zap,
    short_stay: BedDouble,
    sublet: House,
    other: Ellipsis,
  },
  refunds: {
    purchase_return: Package,
    cancelled_booking: CalendarDays,
    insurance_claim: ShieldCheck,
    overpayment: ArrowLeftRight,
    tax_refund: ReceiptText,
    other: Ellipsis,
  },
  deposits: {
    rental_deposit: KeyRound,
    utility_deposit: Zap,
    key_deposit: DoorOpen,
    other: Ellipsis,
  },
  contributions: {
    group_fund: Coins,
    trip_fund: Plane,
    membership_dues: CreditCard,
    gift_received: Gift,
    other: Ellipsis,
  },
  sales: {
    secondhand: Tag,
    tickets: Film,
    food_drinks: Utensils,
    merchandise: Shirt,
    other: Ellipsis,
  },
  earnings: {
    salary: Landmark,
    freelance: Laptop,
    bonus: PartyPopper,
    tips: Coins,
    other: Ellipsis,
  },
  benefits: {
    housing_allowance: House,
    family_allowance: Baby,
    grant: GraduationCap,
    insurance_payout: ShieldCheck,
    other: Ellipsis,
  },
  financial: {
    interest: Percent,
    dividends: Landmark,
    cashback: CreditCard,
    other: Ellipsis,
  },
  other: {},
};

/** Whether a code names an income category, for a value read from storage. */
export function hasIncomeGlyph(
  category: string | null,
): category is IncomeCategory {
  return category !== null && Object.hasOwn(INCOME_CATEGORIES, category);
}
