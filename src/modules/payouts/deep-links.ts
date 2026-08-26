import { money, toMajorString } from "@/modules/currencies/money";

/**
 * Opening the app the money is actually paid in, with the payment already
 * written out.
 *
 * The settle screen knows who is owed, how much, in what currency, and by which
 * of the payee's methods. Every one of those is a field the payer would
 * otherwise retype into another app — and the IBAN digit that goes wrong is
 * only the most expensive of them.
 *
 * ## What is in the table, and what is not
 *
 * Only providers that publish a link a **third party can construct**, from a
 * detail this app already stores, and where the shape was checked against the
 * provider's own documentation. That is a much shorter list than the method
 * catalogue, and deliberately so.
 *
 * The rest are absent for one of three reasons, none of which is an oversight:
 *
 *  - **Merchant-only.** TWINT paylinks resolve a registered acquirer code
 *    (`go.twint.ch/1/e/tw?tw=acq.…`), and a Swish deep link carries a token
 *    minted by a server-side Merchant API call. Neither can be built from a
 *    phone number, which is what a person has.
 *  - **Payee-generated.** Lydia money pots, Vipps/MobilePay payment links,
 *    Satispay and Payconiq all mint a link or a QR at the receiving end. The
 *    payer cannot derive one; only the payee can hand one over.
 *  - **Bank-mediated or code-based.** Zelle, Bizum, BLIK, PayID, Interac and
 *    Pix all happen inside the payer's own banking app, or through a code that
 *    is typed rather than followed. There is no URL to open.
 *
 * Wise is a near miss worth naming: `wise.com/pay/me/<wisetag>` is real, but
 * this app stores an *email address* for Wise (`payoutFieldFor`), and an email
 * is not a Wisetag. A link built from the wrong field is worse than none.
 *
 * ## https over custom schemes
 *
 * A universal link opens the app when it is installed and shows the provider's
 * own page when it is not, which is the whole of the fallback story and needs
 * no detection. A custom scheme — `upi://` — does nothing at all in a desktop
 * browser, so those are marked and the caller only offers them where an app
 * could plausibly answer.
 *
 * ## The amount is not always safe to write
 *
 * Several of these links take a bare number in a currency the provider fixes:
 * Venmo and Cash App are dollars, a UPI intent is rupees. Writing "83.34" into
 * one of those when the debt is in euros would open a payment for the wrong
 * sum, correct to two decimal places and wrong by a third — the single worst
 * thing this feature could do. So an amount is written only where the link can
 * carry the currency too (PayPal) or where the debt is already in the one
 * currency the link means, and every other case links to the person and leaves
 * the figure to them.
 *
 * Sources, checked August 2026:
 *  - PayPal.Me FAQ — `paypal.me/<user>/<amount><CUR>`
 *  - Venmo web deep links — `venmo.com/<user>?txn=pay&amount=&note=`
 *  - Cash App $cashtag URLs — `cash.app/$<tag>/<amount>`
 *  - Revolut.me and Monzo.me help pages — bare profile links, no amount
 *  - NPCI UPI Linking Specification — `upi://pay?pa=&pn=&am=&cu=&tn=`
 */

export interface PayoutDeepLink {
  readonly href: string;
  /**
   * `universal` is an https link: it opens the app when installed and the
   * provider's page when not, everywhere. `scheme` is a custom protocol, which
   * only resolves where the app is actually installed.
   */
  readonly kind: "universal" | "scheme";
  /** Whether the sum is written into the link, for the caller to say so. */
  readonly carriesAmount: boolean;
}

export interface PayoutLinkRequest {
  readonly method: string;
  /** The payee's own detail, as stored. */
  readonly detail: string;
  /** The debt, in minor units. */
  readonly minorUnits: string;
  readonly currency: string;
  /** What the payment is for — a group name. Written only where it is private. */
  readonly note?: string;
}

/**
 * The link that opens this payment, or null when the provider publishes none.
 *
 * Null is the common answer and not a failure: most of the catalogue is either
 * merchant-only, payee-generated or bank-mediated, and a button that resolves
 * to nothing is worse than no button at all.
 */
export function payoutDeepLink(
  request: PayoutLinkRequest,
): PayoutDeepLink | null {
  const detail = request.detail.trim();
  if (detail === "") return null;

  switch (request.method) {
    case "paypal":
      return paypal(detail, request);
    case "revolut":
      return profile("https://revolut.me/", stripLeading(detail, "@"));
    case "monzo":
      return profile("https://monzo.me/", stripLeading(detail, "@"));
    case "venmo":
      return venmo(stripLeading(detail, "@"), request);
    case "cash_app":
      return cashApp(stripLeading(detail, "$"), request);
    case "upi":
      return upi(detail, request);
    default:
      return null;
  }
}

/**
 * PayPal.Me, which is the one that takes any currency.
 *
 * The stored detail is a link the owner typed, so it is used rather than
 * rebuilt — but the amount is only appended to a genuine `paypal.me` address.
 * The field accepts any payment link, and appending `/83.34EUR` to somebody's
 * personal site would produce a 404 out of a link that worked.
 */
function paypal(
  detail: string,
  request: PayoutLinkRequest,
): PayoutDeepLink | null {
  const url = asUrl(detail);
  if (!url) return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "paypal.me" && host !== "paypal.com") {
    return { href: url.toString(), kind: "universal", carriesAmount: false };
  }

  // `<amount><CURRENCY>`, no separator, exactly as the FAQ writes it.
  const path = url.pathname.replace(/\/+$/, "");
  const amount = `${majorOf(request)}${request.currency.toUpperCase()}`;
  url.pathname = `${path}/${amount}`;
  return { href: url.toString(), kind: "universal", carriesAmount: true };
}

/**
 * Venmo, which is dollars and a note.
 *
 * The https form rather than `venmo://`: it opens the app on a phone and lands
 * on the person's profile on a desktop, where Venmo no longer lets a payment
 * start at all. Either way the payer ends up looking at the right person.
 *
 * The note travels because a Venmo payment with no note is a puzzle later. It
 * is the group's name and nothing else — no amount, no other member — and
 * Venmo shows it under whatever feed privacy that account is set to.
 */
function venmo(
  handle: string,
  request: PayoutLinkRequest,
): PayoutDeepLink | null {
  if (!isSimpleHandle(handle)) return null;

  const url = new URL(`https://venmo.com/${encodeURIComponent(handle)}`);
  url.searchParams.set("txn", "pay");
  // Venmo's field is dollars with no currency beside it, so a euro debt names
  // the person and stops there.
  const dollars = request.currency.toUpperCase() === "USD";
  if (dollars) url.searchParams.set("amount", majorOf(request));
  if (request.note) url.searchParams.set("note", request.note);

  return { href: url.toString(), kind: "universal", carriesAmount: dollars };
}

/** Cash App, where the amount is a path segment and is likewise dollars. */
function cashApp(
  cashtag: string,
  request: PayoutLinkRequest,
): PayoutDeepLink | null {
  if (!isSimpleHandle(cashtag)) return null;

  const base = `https://cash.app/$${encodeURIComponent(cashtag)}`;
  const dollars = request.currency.toUpperCase() === "USD";
  return {
    href: dollars ? `${base}/${majorOf(request)}` : base,
    kind: "universal",
    carriesAmount: dollars,
  };
}

/**
 * A UPI intent, which every Indian payment app registers.
 *
 * The one custom scheme here, and the one place a scheme is the right answer:
 * `upi://pay` is the interoperable standard rather than one provider's idea,
 * so it opens whichever app the payer actually uses instead of picking one for
 * them. It resolves to nothing on a desktop, which is what `kind` is for.
 */
function upi(vpa: string, request: PayoutLinkRequest): PayoutDeepLink | null {
  // A virtual payment address is `name@bank`, and nothing else belongs here.
  if (!/^[a-z0-9.\-_]{2,}@[a-z][a-z0-9.\-]*$/i.test(vpa)) return null;

  const query = new URLSearchParams({ pa: vpa });
  const rupees = request.currency.toUpperCase() === "INR";
  if (rupees) {
    query.set("am", majorOf(request));
    query.set("cu", "INR");
  }
  if (request.note) query.set("tn", request.note);

  return {
    href: `upi://pay?${query.toString()}`,
    kind: "scheme",
    carriesAmount: rupees,
  };
}

/** A bare profile link: opens the app on the right person, amount left blank. */
function profile(base: string, handle: string): PayoutDeepLink | null {
  if (!isSimpleHandle(handle)) return null;
  return {
    href: `${base}${encodeURIComponent(handle)}`,
    kind: "universal",
    carriesAmount: false,
  };
}

/**
 * The sum as these links want it: a dot, two places, no separators and no
 * symbol. Never `Intl` — that formats for a reader, and this is read by a
 * parser that would take "1 234,56" for something else entirely.
 */
function majorOf(request: PayoutLinkRequest): string {
  return toMajorString(money(BigInt(request.minorUnits), request.currency));
}

/**
 * A username with nothing in it that could change the shape of a URL.
 *
 * Details are free text — the store checks a handle against no pattern on
 * purpose, since the provider owns its shape — so a slash or a dot-dot in one
 * would silently point the link somewhere else. Anything unusual gets no link
 * rather than a guessed one.
 */
function isSimpleHandle(handle: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(handle);
}

function stripLeading(value: string, character: string): string {
  return value.startsWith(character) ? value.slice(1) : value;
}

/** People write links without a scheme; a bare one is read as a local path. */
function asUrl(detail: string): URL | null {
  try {
    const url = new URL(
      /^https?:\/\//i.test(detail) ? detail : `https://${detail}`,
    );
    // http is upgraded rather than followed: this is somebody's money.
    url.protocol = "https:";
    return url;
  } catch {
    return null;
  }
}
