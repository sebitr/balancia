"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Copy, ExternalLink, QrCode } from "lucide-react";
import { needsDetail, payoutFieldFor } from "@/modules/payouts/fields";
import { displayPayoutDetail } from "@/modules/payouts/format";
import { payoutDeepLink } from "@/modules/payouts/deep-links";
import { useAppLinksWork } from "./use-app-links-work";
import { findPaymentMethod } from "@/modules/settlements/payment-methods";
import { MethodMark } from "@/components/settlements/method-mark";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useNumberLocale } from "@/i18n/format-context";
import { formatMoney, money } from "@/modules/currencies/money";
import { cn } from "@/lib/utils";
import { PaymentQr } from "./payment-qr";
import type {
  PaymentQrRefusal,
  PaymentQrStandard,
} from "@/modules/payouts/qr/payment-qr";

/** One way somebody accepts money, as the owner listed it. */
export interface PayoutMethodChoice {
  readonly method: string;
  readonly detail: string;
  /** This scheme's own payment code, when it has one for this debt. */
  readonly qr?: { standard: PaymentQrStandard; payload: string } | null;
  /** Why it has none, when the reader can act on the reason. */
  readonly qrMissing?: PaymentQrRefusal | null;
}

/**
 * The standards whose payload is text a person can paste.
 *
 * Pix calls it *Copia e Cola* and it is how a great many Brazilians actually
 * pay — the camera is the alternative, not the default. SPAYD and the Polish
 * code are the same kind of artefact. The two SEPA codes are not: an EPC
 * payload is eleven newline-separated lines and a Swiss one is thirty-odd,
 * and neither goes anywhere useful in a paste field.
 */
const PASTEABLE: ReadonlySet<PaymentQrStandard> = new Set([
  "pix",
  "spayd",
  "zbp",
  "swish",
]);

/**
 * Every way the person you owe accepts money, shown where you are about to pay
 * them.
 *
 * A menu, not one method. This used to show only the top of the owner's list,
 * on the reasoning that they had ranked it and the first row was their answer.
 * That reasoning was about *them*; the reader is the one holding the phone, and
 * a preference is not a capability. Somebody who has TWINT and Revolut but does
 * not bank in Switzerland cannot use the first and can use the second, and the
 * old row left them holding an unusable number with no hint another existed. So
 * the whole list appears, in the owner's order, with their first marked as the
 * one they would rather have — a recommendation the reader is free to decline.
 *
 * Nothing here is fetched by name: the row exists only because the balances say
 * this reader owes this person, which is the whole of the permission (see
 * `listPayoutsOwed`).
 *
 * The detail is copyable because the alternative is transcribing an IBAN by
 * hand from one app into another, which is exactly where the digit goes wrong.
 *
 * What sits under the detail is whatever the method can honestly offer:
 *
 *  - a **bank transfer** with a code behind it opens the code, which is the one
 *    thing here that beats copying;
 *  - a **payment link** — PayPal.me and its kind — opens, because the address
 *    its owner typed *is* the destination and nothing has to be guessed;
 *  - **cash** says there is nothing to copy and names the sum, rather than
 *    offering an empty surface and a dead button;
 *  - everything else offers copying alone. Deep-linking into TWINT or Revolut
 *    would need a URL scheme per provider that nothing in this repository can
 *    verify, and a button that silently does nothing is worse than no button.
 */
export function PayoutHint({
  className,
  name,
  groupName,
  methods,
  picked,
  onPick,
  minorUnits,
  currency,
  qr = null,
  qrMissing = null,
  action,
}: {
  className?: string;
  name: string;
  /** What the payment is for, where a provider's link carries a note. */
  groupName: string;
  /** Every method the payee listed, in their own order. Never empty. */
  methods: readonly PayoutMethodChoice[];
  /** The method whose detail is open, as a code. */
  picked: string;
  onPick: (method: string) => void;
  /** The debt this row is for, which the cash line names. */
  minorUnits: string;
  currency: string;
  /** Built on the server from the bank entry; null when no standard fits. */
  qr?: { standard: PaymentQrStandard; payload: string } | null;
  /** Why there is no code, when the reader can act on the reason. */
  qrMissing?: PaymentQrRefusal | null;
  /**
   * What the reader does once they have paid, drawn at the foot of the panel.
   *
   * The panel is the whole of "how do I hand this over", and the last step of
   * that is saying it happened — so the button belongs inside it, under the
   * number that was copied, rather than adrift below a panel that has already
   * closed the subject. The caller owns it because it is the caller's action:
   * this component knows how to pay somebody, not what recording it means.
   */
  action?: React.ReactNode;
}) {
  const t = useTranslations("payouts");
  const tMethods = useTranslations("paymentMethods");
  const locale = useNumberLocale();
  const labelId = useId();
  const [copied, setCopied] = useState(false);
  const [showingQr, setShowingQr] = useState(false);
  const appLinksWork = useAppLinksWork();

  const labelOf = (method: string): string => {
    const known = findPaymentMethod(method);
    return known ? tMethods(known.id) : method;
  };

  // A selection that names nothing falls back to the owner's own first choice,
  // which is what the row showed before anybody touched it.
  const chosen = methods.find((entry) => entry.method === picked) ?? methods[0];
  if (!chosen) return null;

  const label = labelOf(chosen.method);
  const amount = formatMoney(money(BigInt(minorUnits), currency), {
    locale,
    display: "code",
  });

  /**
   * The one sentence that says why there is no code, or nothing.
   *
   * Written as a fact rather than as an error, because none of these is a
   * mistake the reader made and none of them is theirs to fix. What they came
   * for is the answer to "should I keep looking for a code", and each of these
   * says no in the terms of whoever they are paying.
   *
   * Under the bank chip and nowhere else: it answers "where is the code", and
   * a code was never on offer under TWINT.
   */
  /*
   * The code for the method whose chip is lit, and the reason there is none.
   *
   * Per method now, rather than one code belonging to the bank entry: a Pix
   * key and a Swish number each have a code of their own, and the chip the
   * reader pressed is the one they expect the code to be for. The props are
   * the fallback for a caller that has not been updated yet, and mean what
   * they used to mean — the leading code, which was always the bank's.
   */
  const chosenQr = chosen.qr ?? (chosen.method === "bank" ? qr : null);
  const chosenQrMissing =
    chosen.qrMissing ?? (chosen.method === "bank" ? qrMissing : null);

  const whyNoQr = () => {
    switch (chosenQrMissing) {
      case "addressMissing":
        return t("qrNoneAddress", { name });
      case "qrIban":
        return t("qrNoneQrIban", { name });
      case "currency":
        return t("qrNoneCurrency", { currency });
      default:
        return null;
    }
  };
  // Under the lit chip and nowhere else: it answers "where is the code", and a
  // code was never on offer under TWINT.
  const why = chosenQr ? null : whyNoQr();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(chosen.detail);
      setCopied(true);
      toast.success(t("detailCopied"));
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // A browser that refuses the clipboard leaves the text on screen to be
      // selected by hand, which is what it was before there was a button.
    }
  };

  /*
   * The link that opens the app with the payment already written out, if this
   * provider publishes one a payer can build. Most do not — see `deep-links`,
   * where each absence has a reason beside it.
   *
   * A custom scheme resolves to nothing without the app, so those wait until
   * the browser looks like something that could have it. An https link needs no
   * such care: it falls back to the provider's own page by itself.
   */
  const app = payoutDeepLink({
    method: chosen.method,
    detail: chosen.detail,
    minorUnits,
    currency,
    note: groupName,
    payeeName: name,
  });
  const link = app && (app.kind === "universal" || appLinksWork) ? app : null;

  /*
   * A link this browser cannot follow, offered to the phone instead.
   *
   * `upi://` resolves to nothing on a desktop, which is why the button above
   * waits for a browser that could have the app. But the payer is very often
   * at a laptop with their phone in their hand, and a QR code carrying the
   * same string bridges exactly that: point the camera at the screen and the
   * payment app opens on the device that has it.
   *
   * Only where there is no scheme code of its own. When there is, that code is
   * the better artefact — it is what the payer's bank designed its scanner
   * around — and two codes on one row is a choice nobody should have to make.
   */
  const scanInstead = !chosenQr && app && !link ? app : null;

  const hasDetail = needsDetail(chosen.method) && chosen.detail !== "";

  /*
   * The detail as the payer reads it, which is not the detail they copy.
   *
   * A phone number is stored as `+41791234567`, and this is the screen where
   * somebody checks it against the one in their own contacts, character by
   * character — so it is shown in the groups its country writes it in. The
   * button beside it still copies what the account holds: spaces survive most
   * payee fields and are refused by some, and the copy exists to be pasted.
   */
  const shownDetail = displayPayoutDetail(chosen.method, chosen.detail);

  return (
    /* A panel, not a run of controls under a line. Everything in here answers
       one question — how the money actually gets there — and the reader is
       switching between methods inside it, so it needs an edge of its own to
       switch inside of. */
    <div
      className={cn(
        "flex flex-col gap-2.5 rounded-[18px] bg-card p-3.5 ring-1 ring-foreground/10",
        className,
      )}
    >
      <span
        id={labelId}
        className="text-2xs font-semibold tracking-[0.1em] text-muted-foreground uppercase"
      >
        {t("settle.howToPay", { name })}
      </span>

      {/*
        Pressed buttons rather than a radiogroup, which is what the settle
        drawer's own method row does. `radio` reads better — "2 of 4" — but it
        also promises arrow keys, and honouring that promise means a roving
        tabindex this row does not have. Two controls that look identical and
        answer the keyboard differently is the worse outcome.

        Wrapping, never scrolling sideways. A method the reader cannot see is a
        method that does not exist, and the whole point of this row is that the
        second and third ones are findable.
      */}
      <div
        role="group"
        aria-labelledby={labelId}
        className="flex flex-wrap gap-[7px]"
      >
        {methods.map((entry, index) => {
          const active = entry.method === chosen.method;
          const entryLabel = labelOf(entry.method);
          return (
            <button
              key={entry.method}
              type="button"
              aria-pressed={active}
              onClick={() => onPick(entry.method)}
              className={cn(
                "flex h-11 items-center gap-2 rounded-[14px] border py-0 pr-3 pl-2.5 text-sm font-medium transition-colors duration-150",
                active
                  ? "border-primary/30 bg-primary/5"
                  : "border-border bg-background hover:bg-wash-1",
              )}
            >
              <MethodMark
                method={findPaymentMethod(entry.method) ?? null}
                label={entryLabel}
                size={22}
              />
              {entryLabel}
              {/* Only ever on the first, because "preferred" is a statement
                  about the owner's own ordering — and with nothing to prefer it
                  over, it is a badge that says nothing. */}
              {index === 0 && methods.length > 1 && (
                <span className="flex h-5 items-center rounded-full bg-accent px-2 text-2xs font-medium text-accent-foreground">
                  {t("preferred")}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Keyed on the method so switching chips replays the entrance: without
          it React updates the text in place and the surface never moves, which
          reads as nothing having happened. */}
      <div
        key={chosen.method}
        className="flex flex-col gap-2.5 motion-safe:animate-in motion-safe:duration-150 motion-safe:fade-in-0 motion-safe:slide-in-from-top-1"
      >
        {hasDetail ? (
          <div className="flex items-center gap-2 rounded-[14px] bg-muted py-2 pr-2 pl-3.5">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-2xs font-semibold tracking-[0.09em] text-muted-foreground uppercase">
                {fieldNameOf(chosen.method, label, t("fields.iban.label"))}
              </span>
              {/* Mono, because this is read a character at a time and typed
                  into another app: a 1 that could be an l costs a payment. */}
              <span className="truncate font-mono text-sm">{shownDetail}</span>
            </div>

            <button
              type="button"
              onClick={() => void copy()}
              aria-label={copied ? t("copied") : t("copy")}
              className="flex size-11 shrink-0 items-center justify-center rounded-[12px] border border-border bg-card transition-colors duration-150 hover:bg-wash-1"
            >
              {copied ? (
                <Check
                  aria-hidden="true"
                  className="size-4 text-positive-ink"
                />
              ) : (
                <Copy aria-hidden="true" className="size-4" />
              )}
              {/* The icon changes for the eye; this is the same news for a
                screen reader, which cannot see it change. */}
              <span aria-live="polite" className="sr-only">
                {copied ? t("copied") : ""}
              </span>
            </button>
          </div>
        ) : (
          /* Cash has nothing to copy and no app to open. Naming the sum is the
             only useful thing left, and it beats an empty surface. */
          <p className="rounded-[14px] bg-muted px-3.5 py-3 text-xs text-muted-foreground">
            {t("cashNothing", { amount })}
          </p>
        )}

        {why && (
          <p className="text-xs text-pretty text-muted-foreground">{why}</p>
        )}

        {(chosenQr || scanInstead) && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowingQr(true)}
            className="h-[46px] w-full rounded-[14px] border-border bg-background text-sm font-medium"
          >
            <QrCode aria-hidden="true" />
            {chosenQr ? t("qrShowSheet") : t("qrScanWithPhone")}
          </Button>
        )}

        {link && (
          <div className="flex flex-col gap-1.5">
            <Button
              asChild
              variant="outline"
              className="h-[46px] w-full rounded-[14px] border-border bg-background text-sm font-medium"
            >
              {/* `noreferrer` because where somebody paid a debt from is not
                  the payee's business. */}
              <a href={link.href} target="_blank" rel="noopener noreferrer">
                <ExternalLink aria-hidden="true" />
                {t("openApp", { method: label })}
              </a>
            </Button>

            {/* Said out loud, because the difference decides whether the payer
                still has to type the figure once they are over there — and
                finding that out after the app has opened is finding it out too
                late to have kept the number in mind. */}
            <span className="px-0.5 text-2xs text-muted-foreground">
              {link.carriesAmount
                ? t("openAppWithAmount", { amount })
                : t("openAppNoAmount")}
            </span>
          </div>
        )}
      </div>

      {/* Outside the keyed block: the button is the same button whichever
          method is lit, and replaying its entrance on every chip press would
          say something had changed about it when nothing had. */}
      {action && <div className="pt-0.5">{action}</div>}

      {/* Kept outside the keyed block so switching chips does not unmount an
          open sheet. The account it names is the bank entry's, which is what
          the code was built from — never whichever chip happens to be lit. */}
      {(chosenQr || scanInstead) && (
        <QrSheet
          open={showingQr}
          onOpenChange={setShowingQr}
          name={name}
          amount={amount}
          detail={shownDetail}
          method={label}
          qr={chosenQr ?? null}
          link={scanInstead?.href ?? null}
        />
      )}
    </div>
  );
}

/**
 * The code, full width and over everything else.
 *
 * A sheet rather than an accordion inside the row: the code is held up to a
 * camera, so it wants the width of the screen — and opening it in place pushed
 * the button that records the payment off the bottom of the phone, on the one
 * row where that button is the point.
 */
function QrSheet({
  open,
  onOpenChange,
  name,
  amount,
  detail,
  method,
  qr,
  link,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  amount: string;
  /**
   * The payee's own detail, shown under the code so the two can be checked —
   * spaced for reading, since checking is the only thing done with it here.
   */
  detail: string;
  /** What the method is called, for the heading on a link code. */
  method: string;
  /** A scheme's own code, or null when this is a link offered to a phone. */
  qr: { standard: PaymentQrStandard; payload: string } | null;
  link: string | null;
}) {
  const t = useTranslations("payouts");
  const [copiedCode, setCopiedCode] = useState(false);

  const payload = qr?.payload ?? link;
  if (!payload) return null;

  /*
   * A code that is also text worth pasting gets a button for it.
   *
   * This is not a convenience. In Brazil the paste — *Pix Copia e Cola* — is
   * the ordinary way to pay, and a screen that offers only a camera has hidden
   * the path most of its readers would have taken.
   */
  const pasteable = qr !== null && PASTEABLE.has(qr.standard);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(payload);
      setCopiedCode(true);
      toast.success(t("qrCodeCopied"));
      window.setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      // Same as the detail above: a refused clipboard leaves the code drawn on
      // screen, which is the thing the sheet was opened for anyway.
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="mx-auto max-h-[90svh] max-w-[390px] items-center gap-3 overflow-y-auto rounded-t-[24px] bg-card px-5 pb-[22px] data-[side=bottom]:border-t-0"
      >
        <SheetTitle className="text-base font-semibold tracking-[-0.02em]">
          {qr ? t("qrSheetTitle", { name }) : t("qrScanTitle", { method })}
        </SheetTitle>

        <PaymentQr
          payload={payload}
          standard={qr?.standard ?? null}
          label={t("qrTitle")}
        />

        <div className="flex flex-col items-center gap-1 text-center">
          <p className="text-sm font-semibold">
            {t("qrAmountTo", { amount, name })}
          </p>
          <p className="font-mono text-2xs break-all text-muted-foreground">
            {detail}
          </p>
          <p className="text-xs text-muted-foreground">
            {qr ? t(standardNoteKey(qr.standard)) : t("qrScanNote", { method })}
          </p>
        </div>

        {pasteable && (
          <Button
            type="button"
            variant="outline"
            onClick={() => void copyCode()}
            className="h-11 w-full rounded-lg border-input bg-wash-1 text-sm font-medium"
          >
            {copiedCode ? (
              <Check aria-hidden="true" className="size-4 text-positive-ink" />
            ) : (
              <Copy aria-hidden="true" className="size-4" />
            )}
            {copiedCode ? t("qrCodeCopied") : t("qrCopyCode")}
          </Button>
        )}

        <Button
          type="button"
          variant="ghost"
          onClick={() => onOpenChange(false)}
          className="h-11 w-full rounded-lg text-sm font-medium"
        >
          {t("qrClose")}
        </Button>
      </SheetContent>
    </Sheet>
  );
}

/**
 * What to call the field the detail sits in.
 *
 * An IBAN says "IBAN", because that is the word on the form at the other end.
 * A Revtag says "Revtag" for the same reason — it is what Revolut calls the
 * thing, and "Your handle there" beside a Revolut tile answers a question
 * nobody asked. Everything else takes the method's own label, which is the most
 * this can honestly say.
 */
/**
 * Which sentence names the scheme a code belongs to.
 *
 * A key rather than a translated string, because the translator this is read
 * beside is typed against its own namespace — handing it around as a plain
 * function would trade that check for nothing.
 *
 * The line matters more than a caption usually does: somebody holding up a
 * code wants to know their app will recognise it *before* they open the app,
 * and "Pix" or "Swish" answers that where "payment code" does not.
 */
function standardNoteKey(standard: PaymentQrStandard) {
  switch (standard) {
    case "swiss":
      return "qrSwiss" as const;
    case "pix":
      return "qrPix" as const;
    case "swish":
      return "qrSwish" as const;
    case "spayd":
      return "qrSpayd" as const;
    case "zbp":
      return "qrZbp" as const;
    default:
      return "qrEpc" as const;
  }
}

function fieldNameOf(method: string, label: string, ibanLabel: string): string {
  if (payoutFieldFor(method) === "iban") return ibanLabel;
  if (method === "revolut") return "Revtag";
  return label;
}
