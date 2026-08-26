import { z } from "zod";
import { getCurrentUser } from "@/lib/security/actor";
import {
  getPayoutAddress,
  listPayoutMethods,
  PayoutValidationError,
  replacePayoutMethods,
  savePayoutAddress,
} from "@/modules/payouts/service";
import {
  invalidInput,
  mobileApiError,
  noStore,
  readJsonBody,
} from "@/app/api/mobile";
import { trackRoute } from "@/lib/metrics/http";

/**
 * How the account wants to be paid back — the native side of the settings
 * screen the web calls "Get paid".
 *
 * The reader's own details only. Somebody else's are reachable only through
 * `/api/groups/:groupId/settle-up`, which answers for the people the balances
 * say the caller owes and for nobody else; there is deliberately no route
 * that takes a name and returns an IBAN.
 *
 * PUT replaces the whole ordered list, like the currency favourites and for
 * the same reason: the order is the owner's and the server cannot reconstruct
 * it from a single toggle. Unlike the favourites it is not fire-and-forget —
 * an IBAN that fails to save costs somebody the money they were owed, and a
 * rejected detail comes back naming the method it belongs to so the app can
 * point at the right row.
 */

const ROUTE = "/api/profile/payouts";

const bodySchema = z.object({
  methods: z
    .array(
      z.object({
        method: z.string().trim().min(2).max(40),
        detail: z.string().max(200).default(""),
      }),
    )
    .max(8)
    .optional(),
  /** Null clears it, which is how an address is withdrawn. */
  address: z
    .object({
      street: z.string().trim().max(70).nullable().default(null),
      buildingNumber: z.string().trim().max(16).nullable().default(null),
      postalCode: z.string().trim().min(1).max(16),
      town: z.string().trim().min(1).max(35),
      country: z
        .string()
        .trim()
        .regex(/^[A-Za-z]{2}$/)
        .transform((value) => value.toUpperCase()),
    })
    .nullable()
    .optional(),
});

export async function GET() {
  return trackRoute(ROUTE, "GET", handleGet);
}

export async function PUT(request: Request) {
  return trackRoute(ROUTE, "PUT", () => handlePut(request));
}

async function handleGet() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return noStore({ error: "Sign in to continue." }, { status: 401 });
    }
    const [methods, address] = await Promise.all([
      listPayoutMethods(user.userId),
      getPayoutAddress(user.userId),
    ]);
    return noStore({
      methods: methods.map((entry) => ({
        method: entry.method,
        detail: entry.detail,
      })),
      address,
    });
  } catch (error) {
    return mobileApiError(error, `${ROUTE} GET`);
  }
}

async function handlePut(request: Request) {
  const body = await readJsonBody(request);
  if (body === undefined) {
    return noStore({ error: "Send a JSON body." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return invalidInput(parsed.error);
  }

  try {
    const user = await getCurrentUser();
    if (!user) {
      return noStore({ error: "Sign in to continue." }, { status: 401 });
    }

    if (parsed.data.methods !== undefined) {
      await replacePayoutMethods(user.userId, parsed.data.methods);
    }
    if (parsed.data.address !== undefined) {
      await savePayoutAddress(user.userId, parsed.data.address);
    }
    return noStore({ ok: true });
  } catch (error) {
    if (error instanceof PayoutValidationError) {
      /*
       * The method and the reason, not a finished sentence: the app writes
       * the words. `reason` is a key under `payouts.errors` and `method` one
       * under `paymentMethods`, which are the same two catalogues the native
       * catalogue is generated from, so both ends name the same thing.
       */
      return noStore(
        {
          error: "That payment detail is not valid.",
          method: error.method,
          reason: error.reason,
        },
        { status: 422 },
      );
    }
    return mobileApiError(error, `${ROUTE} PUT`);
  }
}
