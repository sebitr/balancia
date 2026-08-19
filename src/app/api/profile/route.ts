import { z } from "zod";
import { getCurrentUser } from "@/lib/security/actor";
import {
  saveUserFavoriteCurrencies,
  saveUserPreferredCurrency,
} from "@/modules/auth/service";
import { isSupportedCurrency } from "@/modules/currencies/iso-4217";
import {
  invalidInput,
  mobileApiError,
  noStore,
  readJsonBody,
} from "@/app/api/mobile";
import { trackRoute } from "@/lib/metrics/http";

/**
 * The account's money preferences. Reads come with `GET /api/auth/session`;
 * this route only writes. `preferredCurrency: null` clears the choice, and
 * the favourites list is the whole ordered list each time — the star is a
 * toggle, not a diff.
 */
const patchSchema = z.object({
  preferredCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .refine((value) => value === "" || isSupportedCurrency(value), {
      message: "Unknown currency.",
    })
    .nullable()
    .optional(),
  favoriteCurrencies: z.array(z.string()).max(30).optional(),
});

export async function PATCH(request: Request) {
  return trackRoute("/api/profile", "PATCH", () => handlePatch(request));
}

async function handlePatch(request: Request) {
  const body = await readJsonBody(request);
  if (body === undefined) {
    return noStore({ error: "Send a JSON body." }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return invalidInput(parsed.error);
  }

  try {
    const user = await getCurrentUser();
    if (!user) {
      return noStore({ error: "Sign in to continue." }, { status: 401 });
    }

    if (parsed.data.preferredCurrency !== undefined) {
      const value = parsed.data.preferredCurrency;
      await saveUserPreferredCurrency(
        user.userId,
        value === null || value === "" ? null : value,
      );
    }
    if (parsed.data.favoriteCurrencies !== undefined) {
      await saveUserFavoriteCurrencies(
        user.userId,
        parsed.data.favoriteCurrencies,
      );
    }
    return noStore({ ok: true });
  } catch (error) {
    return mobileApiError(error, "/api/profile PATCH");
  }
}
