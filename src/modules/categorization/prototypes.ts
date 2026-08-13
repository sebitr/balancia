import type { ExpenseCategory } from "./types";

/**
 * Semantic prototypes.
 *
 * A category is compared against several short sentences that mean it, in
 * every language the instance cares about, rather than against its name. The
 * name alone is a poor anchor: "Autre" and "Other" sit near everything, and a
 * multilingual model puts `dîner` next to `dinner` only if it has both to
 * compare against.
 *
 * Keep them short, concrete and phrased like a purchase. Adding a language
 * means appending its phrases to each list — nothing else changes.
 *
 * `other` has none. Nothing is semantically similar to "not classified".
 */
export const CATEGORY_PROTOTYPES: Readonly<
  Partial<Record<ExpenseCategory, readonly string[]>>
> = {
  groceries: [
    "groceries",
    "grocery store",
    "supermarket",
    "food shopping",
    "courses alimentaires",
    "supermarché",
    "épicerie",
    "achat alimentaire",
  ],
  restaurants: [
    "restaurant",
    "coffee shop",
    "food delivery",
    "dinner with friends",
    "lunch",
    "café",
    "livraison de repas",
    "dîner au restaurant",
    "déjeuner",
  ],
  transport: [
    "train ticket",
    "bus fare",
    "taxi ride",
    "parking",
    "fuel for the car",
    "billet de train",
    "transports publics",
    "essence",
    "place de parking",
  ],
  housing: [
    "monthly rent",
    "mortgage payment",
    "landlord",
    "service charges for the flat",
    "loyer mensuel",
    "charges de copropriété",
    "régie immobilière",
  ],
  utilities: [
    "electricity bill",
    "water bill",
    "internet subscription at home",
    "mobile phone bill",
    "heating",
    "facture d'électricité",
    "facture d'eau",
    "abonnement internet",
    "chauffage",
  ],
  shopping: [
    "clothes",
    "electronics",
    "furniture for the flat",
    "online order",
    "shoes",
    "vêtements",
    "électroménager",
    "meubles",
    "achat en ligne",
  ],
  health: [
    "doctor's appointment",
    "pharmacy",
    "dentist",
    "prescription medicine",
    "glasses",
    "rendez-vous chez le médecin",
    "pharmacie",
    "dentiste",
    "médicaments",
  ],
  entertainment: [
    "cinema ticket",
    "concert",
    "museum entry",
    "video game",
    "night out",
    "place de cinéma",
    "concert",
    "musée",
    "jeu vidéo",
  ],
  travel: [
    "hotel night",
    "flight ticket",
    "holiday accommodation",
    "campsite",
    "nuit d'hôtel",
    "billet d'avion",
    "location de vacances",
    "camping",
  ],
  subscriptions: [
    "monthly subscription",
    "streaming service",
    "annual membership",
    "cloud storage plan",
    "abonnement mensuel",
    "service de streaming",
    "adhésion annuelle",
  ],
  family: [
    "childcare",
    "nursery fees",
    "babysitter",
    "school supplies",
    "kids activity",
    "garde d'enfants",
    "crèche",
    "cantine scolaire",
    "fournitures scolaires",
  ],
  pets: [
    "pet food",
    "veterinarian",
    "dog grooming",
    "cat litter",
    "nourriture pour chien",
    "vétérinaire",
    "toilettage",
    "animalerie",
  ],
  gifts: [
    "birthday present",
    "wedding gift",
    "charity donation",
    "flowers for someone",
    "cadeau d'anniversaire",
    "cadeau de mariage",
    "don à une association",
    "livraison de fleurs",
  ],
  fees: [
    "bank charges",
    "card fee",
    "currency conversion fee",
    "late payment fee",
    "frais bancaires",
    "frais de carte",
    "frais de change",
    "frais de retard",
  ],
};
