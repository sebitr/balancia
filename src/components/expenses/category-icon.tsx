import {
  Accessibility,
  ArrowLeftRight,
  Baby,
  Backpack,
  Banknote,
  Bath,
  BedDouble,
  BedSingle,
  Beef,
  Bike,
  Bone,
  BookOpen,
  BookUser,
  Brain,
  Brush,
  Building2,
  BusFront,
  Cake,
  Calculator,
  CalendarDays,
  Car,
  CarFront,
  CarTaxiFront,
  Church,
  CircleArrowDown,
  CircleParking,
  CirclePlay,
  ClipboardCheck,
  Clock,
  Cloud,
  Code,
  Coffee,
  Coins,
  Compass,
  CreditCard,
  Croissant,
  DoorOpen,
  Droplet,
  Droplets,
  Dumbbell,
  Ellipsis,
  FerrisWheel,
  FileSignature,
  Film,
  Flame,
  Flower2,
  Footprints,
  Fuel,
  Gamepad2,
  Gavel,
  Gem,
  Gift,
  Glasses,
  GraduationCap,
  Hammer,
  Hand,
  HandHeart,
  Handshake,
  Heart,
  HeartPulse,
  Hospital,
  House,
  KeyRound,
  Landmark,
  Laptop,
  LayoutGrid,
  Leaf,
  Library,
  Lock,
  Map,
  Martini,
  Mic,
  Milk,
  Mountain,
  Music,
  Newspaper,
  Package,
  PaintRoller,
  Palette,
  PartyPopper,
  PawPrint,
  Percent,
  PersonStanding,
  PiggyBank,
  Pill,
  Plane,
  Presentation,
  ReceiptText,
  RefreshCw,
  Sandwich,
  Scale,
  School,
  Scissors,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Ship,
  Shirt,
  ShoppingBag,
  ShoppingBasket,
  Smartphone,
  Smile,
  Sofa,
  Soup,
  Sparkles,
  SprayCan,
  Stethoscope,
  Store,
  Tag,
  Tent,
  TestTube,
  Theater,
  Thermometer,
  Ticket,
  ToyBrick,
  TrafficCone,
  TrainFront,
  Trash2,
  Trees,
  TriangleAlert,
  Truck,
  Users,
  Utensils,
  UtensilsCrossed,
  Volleyball,
  Warehouse,
  WashingMachine,
  Watch,
  Wifi,
  Wine,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  isExpenseCategory,
  type ExpenseCategory,
  type SubcategoryOf,
} from "@/modules/categorization";

/**
 * One glyph per category code.
 *
 * The vocabulary itself lives in `modules/categorization/taxonomy.ts`; this is
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
  home: House,
  shopping: ShoppingBag,
  personal_care: Sparkles,
  health: HeartPulse,
  education: GraduationCap,
  entertainment: Ticket,
  activities: Mountain,
  lodging: BedDouble,
  subscriptions: RefreshCw,
  kids_family: Users,
  pets: PawPrint,
  gifts_donations: Gift,
  insurance: ShieldCheck,
  finance_admin: Calculator,
  other: Ellipsis,
};

/**
 * One glyph per subcategory, nested under the category that owns it.
 *
 * Nested rather than flat because a subcategory ID is only unique *within* its
 * category: `other` appears seventeen times, `repairs` and `training` twice
 * each, and `home`, `health` and `travel` are subcategories of `insurance` as
 * well as being — or having been — categories. The pair is the identity, so
 * the pair is the lookup.
 *
 * Exhaustive over the taxonomy for the same reason `CATEGORY_GLYPHS` is: a new
 * code without a glyph should be a compile error, not a blank chip. A glyph is
 * shared wherever the meaning genuinely repeats — a cut is `Scissors` whether
 * it is a hairdresser, a barber or the dog — and `Ellipsis` is always the
 * category's own `other`.
 */
export const SUBCATEGORY_GLYPHS: {
  readonly [C in ExpenseCategory]?: {
    readonly [S in SubcategoryOf<C>]: LucideIcon;
  };
} = {
  groceries: {
    supermarket: Store,
    bakery: Croissant,
    butcher: Beef,
    market: Store,
    convenience_store: Store,
    drinks: Wine,
    other: Ellipsis,
  },
  restaurants: {
    restaurant: Utensils,
    cafe: Coffee,
    bar: Martini,
    fast_food: Sandwich,
    takeaway: ShoppingBag,
    food_delivery: Bike,
    other: Ellipsis,
  },
  transport: {
    public_transport: BusFront,
    taxi_ride_hailing: CarTaxiFront,
    fuel: Fuel,
    parking: CircleParking,
    tolls: TrafficCone,
    train: TrainFront,
    flights: Plane,
    ferry: Ship,
    car_rental: Car,
    bike_scooter: Bike,
    vehicle_purchase: CarFront,
    vehicle_lease: FileSignature,
    vehicle_financing: Banknote,
    vehicle_maintenance: Wrench,
    vehicle_registration: ReceiptText,
    vehicle_wash: Droplets,
    other: Ellipsis,
  },
  home: {
    rent: KeyRound,
    mortgage: Landmark,
    home_purchase: Handshake,
    down_payment: PiggyBank,
    security_deposit: Lock,
    property_tax: ReceiptText,
    electricity: Zap,
    gas: Flame,
    water: Droplet,
    internet: Wifi,
    mobile_phone: Smartphone,
    heating: Thermometer,
    waste: Trash2,
    repairs: Hammer,
    maintenance: Settings,
    renovation: PaintRoller,
    furniture: Sofa,
    appliances: WashingMachine,
    cleaning_supplies: SprayCan,
    household_supplies: Package,
    cleaning_service: SprayCan,
    gardening: Leaf,
    moving: Truck,
    storage: Warehouse,
    other: Ellipsis,
  },
  shopping: {
    clothing: Shirt,
    shoes: Footprints,
    electronics: Laptop,
    accessories: Watch,
    books: BookOpen,
    hobbies: Palette,
    sporting_goods: Volleyball,
    toys: ToyBrick,
    general: ShoppingBag,
    repairs: Wrench,
    other: Ellipsis,
  },
  personal_care: {
    hairdresser: Scissors,
    barber: Scissors,
    beauty: Sparkles,
    cosmetics: Brush,
    skincare: Droplet,
    toiletries: Bath,
    spa: Flower2,
    massage: Hand,
    laundry_dry_cleaning: WashingMachine,
    other: Ellipsis,
  },
  health: {
    doctor: Stethoscope,
    dentist: Smile,
    pharmacy: Pill,
    hospital: Hospital,
    therapy: Brain,
    physiotherapy: PersonStanding,
    labs_tests: TestTube,
    glasses_contacts: Glasses,
    medical_devices: Thermometer,
    fitness: Dumbbell,
    other: Ellipsis,
  },
  education: {
    tuition: GraduationCap,
    school: School,
    courses: BookOpen,
    training: Presentation,
    tutoring: Users,
    books_materials: Library,
    school_supplies: Backpack,
    exams: ClipboardCheck,
    other: Ellipsis,
  },
  entertainment: {
    cinema: Film,
    concerts: Mic,
    shows: Theater,
    nightlife: Martini,
    games: Gamepad2,
    music: Music,
    events: CalendarDays,
    other: Ellipsis,
  },
  activities: {
    attractions: Landmark,
    museums: Landmark,
    tours: Map,
    excursions: Compass,
    sports: Volleyball,
    outdoor_activities: Trees,
    classes_workshops: Presentation,
    theme_parks: FerrisWheel,
    other: Ellipsis,
  },
  lodging: {
    hotel: BedDouble,
    vacation_rental: House,
    hostel: BedSingle,
    camping: Tent,
    guesthouse: DoorOpen,
    other: Ellipsis,
  },
  subscriptions: {
    streaming: CirclePlay,
    software: Code,
    apps: LayoutGrid,
    cloud_storage: Cloud,
    media: Newspaper,
    memberships: CreditCard,
    delivery_memberships: Truck,
    other: Ellipsis,
  },
  kids_family: {
    childcare: Baby,
    babysitting: Clock,
    baby: Milk,
    allowance: Coins,
    family_support: Heart,
    elder_care: HandHeart,
    caregiving: Hand,
    child_support: Coins,
    other: Ellipsis,
  },
  pets: {
    pet_food: Soup,
    veterinary: Stethoscope,
    medication: Pill,
    grooming: Scissors,
    pet_supplies: ShoppingBasket,
    pet_insurance: ShieldCheck,
    boarding: House,
    training: Bone,
    other: Ellipsis,
  },
  gifts_donations: {
    gifts: Gift,
    birthdays: Cake,
    weddings: Gem,
    celebrations: PartyPopper,
    charity: HandHeart,
    donations: Heart,
    religious_giving: Church,
    other: Ellipsis,
  },
  insurance: {
    home: House,
    vehicle: Car,
    health: HeartPulse,
    life: Heart,
    travel: Plane,
    liability: ShieldAlert,
    legal_protection: Scale,
    disability: Accessibility,
    other: Ellipsis,
  },
  finance_admin: {
    bank_fees: Landmark,
    card_fees: CreditCard,
    exchange_fees: ArrowLeftRight,
    interest: Percent,
    loan_payment: Banknote,
    service_fees: Tag,
    taxes: ReceiptText,
    government_fees: Building2,
    passport_visa: BookUser,
    legal: Gavel,
    accounting: Calculator,
    fines: TriangleAlert,
    other: Ellipsis,
  },
};

/**
 * The glyph for a (category, subcategory) pair, or null.
 *
 * Returns null rather than a fallback: a chip with no subcategory is drawn
 * with its category's glyph, and a caller that has no pair has nothing to look
 * up in here.
 */
export function subcategoryGlyph(
  category: string | null,
  subcategory: string | null,
): LucideIcon | null {
  if (!hasGlyph(category) || subcategory === null) return null;
  const glyphs = SUBCATEGORY_GLYPHS[category] as
    Readonly<Record<string, LucideIcon>> | undefined;
  return glyphs?.[subcategory] ?? null;
}

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
