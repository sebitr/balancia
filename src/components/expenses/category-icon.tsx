import {
  ArrowLeftRight,
  BedDouble,
  Car,
  CircleArrowDown,
  Ellipsis,
  Gift,
  HeartPulse,
  House,
  Mountain,
  PawPrint,
  Percent,
  Plane,
  RefreshCw,
  ShoppingBag,
  ShoppingBasket,
  Sofa,
  Tag,
  Ticket,
  Users,
  UtensilsCrossed,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  isExpenseCategory,
  type ExpenseCategory,
} from "@/modules/categorization";

/**
 * One glyph per category code.
 *
 * The vocabulary itself lives in `modules/categorization/types.ts`; this is
 * only how it is drawn, which is why the map is here and not there — that
 * module is pure and framework-free, and `lucide-react` is neither.
 *
 * The record is exhaustive over `ExpenseCategory` on purpose: adding a code
 * without drawing it becomes a type error rather than a blank space on a row.
 */
export const CATEGORY_GLYPHS: Record<ExpenseCategory, LucideIcon> = {
  groceries: ShoppingBasket,
  restaurants: UtensilsCrossed,
  transport: Car,
  housing: House,
  utilities: Zap,
  shopping: ShoppingBag,
  health: HeartPulse,
  entertainment: Ticket,
  travel: Plane,
  lodging: BedDouble,
  activities: Mountain,
  household: Sofa,
  subscriptions: RefreshCw,
  family: Users,
  pets: PawPrint,
  gifts: Gift,
  fees: Percent,
  other: Ellipsis,
};

/**
 * What anything outside the vocabulary is drawn as.
 *
 * A category that is not one of ours came in through an import whose label
 * nothing recognised, and is marked as a label rather than as a thing: we know
 * it was filed under *something*, and guessing which of ours it resembles is
 * exactly the guess the classifier declines to make. Spending with no category
 * at all gets the same mark, because "not filed" and "filed as something we do
 * not know" are equally unreadable to the spread.
 *
 * Callers index `CATEGORY_GLYPHS` themselves rather than going through a
 * helper — a lookup resolves at the call site, where React can see that the
 * component type is one of a fixed set and not a new one per render.
 */
export const FALLBACK_GLYPH: LucideIcon = Tag;

/** True when `category` has a glyph of its own. Narrows for the lookup. */
export function hasGlyph(category: string | null): category is ExpenseCategory {
  return category !== null && isExpenseCategory(category);
}

/**
 * The badge glyphs for the three transaction types a row can carry.
 *
 * `CircleArrowDown` stands in for the handoff's `CircleArrowDownLeft`, which
 * `lucide-react` does not ship — an arrow into a circle is the same sentence
 * ("money came in") drawn with the glyphs that exist.
 */
export const TYPE_GLYPHS = {
  settlement: ArrowLeftRight,
  revenue: CircleArrowDown,
  recurring: RefreshCw,
} as const;
