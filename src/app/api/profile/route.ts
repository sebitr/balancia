import { z } from "zod";
import { getCurrentUser } from "@/lib/security/actor";
import {
  deleteAccount,
  getUserFavoriteCurrencies,
  getUserPreferences,
  getUserPreferredCurrency,
  saveUserAccentColor,
  saveUserFavoriteCurrencies,
  saveUserFormatPreferences,
  saveUserLocale,
  saveUserName,
  saveUserPreferredCurrency,
} from "@/modules/auth/service";
import { clearSessionCookie } from "@/modules/auth/cookies";
import { isSupportedCurrency } from "@/modules/currencies/iso-4217";
import { getLatestEntryForUser } from "@/modules/expenses/service";
import {
  DEFAULT_ACCENT,
  isAccentColor,
  resolveAccent,
} from "@/modules/profile/accent";
import {
  DATE_FORMATS,
  DEFAULT_DATE_FORMAT,
  DEFAULT_NUMBER_FORMAT,
  isDateFormat,
  isNumberFormat,
  NUMBER_FORMATS,
} from "@/i18n/format";
import { DEFAULT_LOCALE, isAppLocale, LOCALES } from "@/i18n/locales";
import {
  invalidInput,
  mobileApiError,
  noStore,
  readJsonBody,
} from "@/app/api/mobile";
import { trackRoute } from "@/lib/metrics/http";

/**
 * Everything the settings screens decide, for a client that cannot run a
 * Server Action.
 *
 * The web writes all of this through `modules/profile/actions.ts`, whose
 * action IDs change on every build; a native client needs a stable route, so
 * this one exposes the same service calls over JSON. It deliberately mirrors
 * those actions rather than inventing a second set of rules — the same
 * validation, the same "a chosen default is stored as absence" convention —
 * because two ends that disagree about what `null` means is how the accent on
 * a phone stops matching the accent in a browser.
 *
 * The one thing the actions do that this cannot is write the cookies. Those
 * exist so a *browser* render knows the answer before it reads the database;
 * a native client keeps no cookie of its own and reads these values from
 * `GET /api/auth/session` at launch. A reader who changes their accent on the
 * phone and then opens the web app gets it from the account column, one render
 * later than a browser-side change would — which is the correct trade for not
 * having a second source of truth.
 */

/**
 * The display preferences, and the one entry the money screen previews.
 *
 * The web's money screen reads the reader's latest entry on the server and
 * renders the preview from it. There is no such thing as a "latest entry"
 * route otherwise, and it is only ever wanted here, so it rides along with the
 * preferences instead of becoming an endpoint of its own.
 */
export async function GET() {
  return trackRoute("/api/profile", "GET", handleGet);
}

async function handleGet() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return noStore({ error: "Sign in to continue." }, { status: 401 });
    }

    const [stored, preferredCurrency, favoriteCurrencies, latestEntry] =
      await Promise.all([
        getUserPreferences(user.userId),
        getUserPreferredCurrency(user.userId),
        getUserFavoriteCurrencies(user.userId),
        getLatestEntryForUser(user.userId),
      ]);

    return noStore({
      profile: {
        name: user.name,
        email: user.email,
        ...resolvedPreferences(stored),
        preferredCurrency,
        favoriteCurrencies,
      },
      latestEntry,
    });
  } catch (error) {
    return mobileApiError(error, "/api/profile GET");
  }
}

/**
 * Null columns as the words the client speaks.
 *
 * The database stores "not chosen" as null; the wire stores it as `"auto"` and
 * `"coral"`, which is what the chips and swatches are labelled with. Doing the
 * translation here — rather than sending nulls and letting each client invent
 * a default — is what keeps a phone and a browser agreeing about which chip is
 * lit for an account that never touched the screen.
 */
function resolvedPreferences(stored: {
  locale: string | null;
  dateFormat: string | null;
  numberFormat: string | null;
  accentColor: string | null;
}) {
  return {
    locale: isAppLocale(stored.locale) ? stored.locale : DEFAULT_LOCALE,
    dateFormat: isDateFormat(stored.dateFormat)
      ? stored.dateFormat
      : DEFAULT_DATE_FORMAT,
    numberFormat: isNumberFormat(stored.numberFormat)
      ? stored.numberFormat
      : DEFAULT_NUMBER_FORMAT,
    accentColor: resolveAccent(stored.accentColor),
  };
}

/**
 * Every field is optional and only what is sent is written, so a client can
 * save one chip without restating the rest of the account.
 *
 * `preferredCurrency: null` clears the choice, and the favourites list is the
 * whole ordered list each time — the star is a toggle, not a diff. The three
 * preferences below take `"auto"` and `"coral"` as the *words* for "not
 * chosen" and store them as null, exactly as the Server Actions do, so an
 * account that never opened the screen and one that came back to the default
 * are the same row.
 */
const patchSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(120).optional(),
  locale: z.enum(LOCALES).optional(),
  accentColor: z
    .string()
    .refine(isAccentColor, { message: "Unknown accent." })
    .optional(),
  dateFormat: z.enum(DATE_FORMATS).optional(),
  numberFormat: z.enum(NUMBER_FORMATS).optional(),
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
    const input = parsed.data;

    if (input.name !== undefined) {
      await saveUserName(user.userId, input.name);
    }
    if (input.locale !== undefined) {
      await saveUserLocale(user.userId, input.locale);
    }
    if (input.accentColor !== undefined) {
      await saveUserAccentColor(
        user.userId,
        input.accentColor === DEFAULT_ACCENT ? null : input.accentColor,
      );
    }
    // Written together because the column pair is written together: sending
    // one alone must not clear the other, so the untouched half is restated.
    if (input.dateFormat !== undefined || input.numberFormat !== undefined) {
      const stored = resolvedPreferences(await getUserPreferences(user.userId));
      const dateFormat = input.dateFormat ?? stored.dateFormat;
      const numberFormat = input.numberFormat ?? stored.numberFormat;
      await saveUserFormatPreferences(user.userId, {
        dateFormat: dateFormat === "auto" ? null : dateFormat,
        numberFormat: numberFormat === "auto" ? null : numberFormat,
      });
    }
    if (input.preferredCurrency !== undefined) {
      const value = input.preferredCurrency;
      await saveUserPreferredCurrency(
        user.userId,
        value === null || value === "" ? null : value,
      );
    }
    if (input.favoriteCurrencies !== undefined) {
      await saveUserFavoriteCurrencies(user.userId, input.favoriteCurrencies);
    }
    return noStore({ ok: true });
  } catch (error) {
    return mobileApiError(error, "/api/profile PATCH");
  }
}

/**
 * Closing the account.
 *
 * The address is required in the body for the same reason the web's confirm
 * sheet asks for it: not as an authorization check — the session already is
 * one, and this re-reads the caller rather than trusting the body — but as
 * friction proportionate to an outcome nothing undoes.
 */
const deleteSchema = z.object({ email: z.string().trim().min(1) });

export async function DELETE(request: Request) {
  return trackRoute("/api/profile", "DELETE", () => handleDelete(request));
}

async function handleDelete(request: Request) {
  const body = await readJsonBody(request);
  if (body === undefined) {
    return noStore({ error: "Send a JSON body." }, { status: 400 });
  }
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return invalidInput(parsed.error);
  }

  try {
    const user = await getCurrentUser();
    if (!user) {
      return noStore({ error: "Sign in to continue." }, { status: 401 });
    }
    if (
      parsed.data.email.toLocaleLowerCase() !== user.email.toLocaleLowerCase()
    ) {
      return noStore(
        { error: "That is not the address on this account." },
        { status: 400 },
      );
    }

    await deleteAccount(user.userId);
    await clearSessionCookie();
    return noStore({ ok: true });
  } catch (error) {
    return mobileApiError(error, "/api/profile DELETE");
  }
}
