"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toastUndoable } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { MethodMark } from "@/components/settlements/method-mark";
import { MethodPickerSheet } from "./method-picker-sheet";
import { PayoutDetailInput } from "./payout-detail-input";
import {
  setPayoutAddressAction,
  setPayoutMethodsAction,
} from "@/modules/payouts/actions";
import {
  needsDetail,
  payoutFieldFor,
  validatePayoutDetail,
  type PayoutFieldError,
} from "@/modules/payouts/fields";
import { phoneExampleFor } from "@/modules/payouts/examples";
import { displayPayoutEntries } from "@/modules/payouts/format";
import { useViewerCountry } from "./use-viewer-country";
import { findPaymentMethod } from "@/modules/settlements/payment-methods";
import type { SwissCreditorAddress } from "@/modules/payouts/qr/swiss";
import {
  EMPTY_ADDRESS,
  isBlankAddress,
  isCompleteAddress,
  isSwissIban,
  sameAddress,
} from "@/modules/payouts/address";
import type { PayoutEntry } from "./payout-methods-form";

/**
 * Methods whose identifier has a name of its own.
 *
 * `payouts/fields.ts` groups by *what the reader has to type* — a handle is a
 * handle whether it is a Revtag or a UPI id — which is the right split for
 * validating one. It is the wrong split for labelling one: "Your handle there"
 * above a Revolut field is a worse instruction than "Revtag", because Revolut
 * calls it a Revtag and so does the person reading it off their app.
 *
 * So the kind decides the rules and this decides the words, and anything not
 * named here falls back to its kind — which is what keeps a method added to
 * the catalogue tomorrow working without an entry.
 */
const NAMED_FIELDS = [
  "alipay",
  "apple_pay",
  "cash_app",
  "crypto",
  "google_pay",
  "interac",
  "monzo",
  "paypal",
  "pix",
  "revolut",
  "upi",
  "wechat_pay",
  "wise",
  "zelle",
] as const;

function hasNamedField(method: string): boolean {
  return (NAMED_FIELDS as readonly string[]).includes(method);
}

/**
 * How people pay you back — only the ways you actually use.
 *
 * This is the settings screen's list, and it is the inverse of the sheet one:
 * that offers the region's four and asks you to tick, this shows what you have
 * and sends you to the whole catalogue for anything else. On a screen with
 * room, a list of your own methods with their own identifiers under them beats
 * a checklist with four suggestions and twenty-nine absences.
 *
 * **Order is the preference.** Whoever owes you money is shown the first one,
 * so the top of this list is an answer rather than a taste. That is why the
 * control is "make this the preferred one" rather than a star: promoting a
 * method moves it, and the row that was first says `Preferred` instead of
 * offering the button.
 *
 * **This one waits.** Everywhere else in settings a tap is written in the
 * background and never reports failure, because the worst case is a preference
 * that does not follow somebody to their next device. Here the worst case is
 * an IBAN that was never stored, discovered by the money not arriving — so a
 * detail is validated before it is sent, the send is awaited, and a refusal
 * comes back naming the row it belongs to.
 *
 * A detail is checked when the field is first left, and on every keystroke
 * afterwards. An IBAN is invalid for the whole time it is being typed, and a
 * checker that shouts through all of it is one people learn to ignore; once
 * somebody has been told what is wrong, though, they want to watch it come
 * right as they fix it.
 */
export function PayoutMethodsCard({
  initial,
  initialAddress = null,
}: {
  initial: readonly PayoutEntry[];
  /** Only ever set, and only ever asked for, alongside a Swiss IBAN. */
  initialAddress?: SwissCreditorAddress | null;
}) {
  const t = useTranslations("payouts");
  const tMethods = useTranslations("paymentMethods");
  const tCommon = useTranslations("common");
  /** Only ever used to choose the example a country writes numbers in. */
  const viewer = useViewerCountry();

  /*
   * The stored details, spaced for reading.
   *
   * What comes back from the server is `+41791234567`, which is the right
   * thing to store and the wrong thing to show — see `payouts/format.ts`. The
   * spacing goes back on before anything reaches a field, and comes off again
   * on the way in, so this is a matter of presentation from here down.
   */
  const [entries, setEntries] = useState<readonly PayoutEntry[]>(() =>
    displayPayoutEntries(initial),
  );
  /**
   * The list the account actually holds, as far as this screen knows.
   *
   * What a refused write rolls back to, and it is deliberately not `initial`:
   * somebody who adds TWINT, types their number, then mistypes an IBAN should
   * lose the IBAN, not the TWINT they already saved three taps ago.
   */
  const [saved, setSaved] = useState<readonly PayoutEntry[]>(() =>
    displayPayoutEntries(initial),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  /** Rows whose field has been left once, and so may complain as it is typed. */
  const [touched, setTouched] = useState<readonly string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const labelOf = (method: string) =>
    findPaymentMethod(method)
      ? tMethods(method as Parameters<typeof tMethods>[0])
      : method;

  const save = (next: readonly PayoutEntry[]) => {
    const previous = saved;
    startTransition(async () => {
      const result = await setPayoutMethodsAction({ methods: next });
      if (!result.ok) {
        // Put the list back: a row showing a detail the account did not keep
        // is worse than no confirmation at all.
        setEntries(previous);
        setErrors((current) => ({
          ...current,
          form: result.error ?? t("saveFailed"),
        }));
        return;
      }
      setSaved(next);
      setErrors((current) => ({ ...current, form: "" }));
      toastUndoable(
        t("saved"),
        {
          label: tCommon("undo"),
          onUndo: () => {
            setEntries(previous);
            setSaved(previous);
            startTransition(async () => {
              await setPayoutMethodsAction({ methods: previous });
            });
          },
        },
        { id: "payout-methods" },
      );
    });
  };

  /** Everything on the list has to be valid, or the whole write is refused. */
  const complete = (list: readonly PayoutEntry[]) =>
    list.every((entry) => !validatePayoutDetail(entry.method, entry.detail));

  const add = (method: string) => {
    if (entries.some((entry) => entry.method === method)) return;
    const next = [...entries, { method, detail: "" }];
    setEntries(next);
    // A method that needs a detail has nothing to save yet, and the row would
    // be refused. Cash and cheques are complete facts the moment they are on.
    if (complete(next)) save(next);
  };

  const remove = (method: string) => {
    const next = entries.filter((entry) => entry.method !== method);
    setEntries(next);
    setErrors((current) => ({ ...current, [method]: "" }));
    // Removing is always a complete fact, even where what is left is not: the
    // half-typed IBAN that blocks a write is exactly what may be going.
    if (complete(next)) save(next);
  };

  const prefer = (method: string) => {
    const chosen = entries.find((entry) => entry.method === method);
    if (!chosen) return;
    const next = [chosen, ...entries.filter((entry) => entry !== chosen)];
    setEntries(next);
    if (complete(next)) save(next);
  };

  const edit = (method: string, detail: string) => {
    const next = entries.map((entry) =>
      entry.method === method ? { ...entry, detail } : entry,
    );
    setEntries(next);
    setErrors((current) => ({
      ...current,
      [method]: touched.includes(method) ? complaint(method, detail) : "",
    }));
  };

  /**
   * What is wrong with a detail, in words.
   *
   * The complaint about a phone number names the same example the field was
   * showing a second ago, which is the whole reason it is worth naming one:
   * "like +39 312 345 6789" under a Satispay field is an instruction, where a
   * Swiss number under the same field is a riddle.
   */
  const messageFor = (method: string, problem: PayoutFieldError) =>
    problem === "phone"
      ? t("errors.phone", { example: phoneExampleFor(method, viewer) })
      : t(`errors.${problem}` as Parameters<typeof t>[0]);

  /** The catalogue key for what is wrong with a detail, already translated. */
  const complaint = (method: string, detail: string) => {
    const problem = validatePayoutDetail(method, detail);
    // Nothing typed yet is not a mistake — it is a row somebody is part-way
    // through. The write is what refuses an empty detail.
    return problem && problem !== "required" ? messageFor(method, problem) : "";
  };

  const commit = (method: string) => {
    const entry = entries.find((candidate) => candidate.method === method);
    if (!entry) return;

    if (!touched.includes(method)) setTouched([...touched, method]);
    const problem = validatePayoutDetail(method, entry.detail);
    setErrors((current) => ({
      ...current,
      [method]: problem ? messageFor(method, problem) : "",
    }));
    if (!problem && complete(entries)) save(entries);
  };

  /*
   * Whether an address is worth asking for.
   *
   * Only the Swiss standard requires one — a German account gets a Girocode,
   * which carries no address, and nobody is asked where they live to be paid
   * by TWINT. So the card waits for the IBAN to say `CH` (or `LI`) and appears
   * from the second character, in time to be filled in the same sitting.
   *
   * It used to appear with the bank row itself, before there was an IBAN to
   * judge, and that put five empty address fields under an empty IBAN: the
   * longest thing on the screen was a question nobody had been asked yet, and
   * it was asked of every country until the IBAN ruled it out.
   */
  const typedIban = (
    entries.find((entry) => entry.method === "bank")?.detail ?? ""
  ).replace(/\s/g, "");
  const wantsAddress = isSwissIban(typedIban);

  return (
    <>
      <section className="flex shrink-0 flex-col overflow-hidden rounded-[20px] bg-card ring-1 ring-foreground/10">
        {entries.map((entry, index) => {
          const label = labelOf(entry.method);
          const kind = payoutFieldFor(entry.method);
          const error = errors[entry.method];
          const named = hasNamedField(entry.method);
          const field = named
            ? `methodFields.${entry.method}`
            : `fields.${kind}`;

          return (
            <div
              key={entry.method}
              className={cn(
                "flex flex-col px-4 pt-2.5 pb-3.5",
                index > 0 && "border-t border-border",
              )}
            >
              <div className="flex min-h-11 items-center gap-2.5">
                <MethodMark
                  method={findPaymentMethod(entry.method) ?? null}
                  label={label}
                  size={26}
                  unbranded="tile"
                />
                <span className="min-w-0 truncate text-sm font-medium">
                  {label}
                </span>
                {index === 0 ? (
                  <span className="shrink-0 rounded-full bg-primary/16 px-1.5 py-0.5 text-2xs font-semibold text-primary-ink">
                    {t("preferred")}
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => prefer(entry.method)}
                    className="shrink-0 rounded-full bg-wash-2 px-2 py-1 text-2xs text-muted-foreground transition-colors hover:bg-wash-4 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
                  >
                    {t("makePreferred")}
                  </button>
                )}
                <span className="flex-1" />
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => remove(entry.method)}
                  aria-label={t("removeMethod", { method: label })}
                  className="tap-target flex size-7 shrink-0 items-center justify-center rounded-full bg-wash-2 text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
                >
                  <Trash2 aria-hidden="true" className="size-3.5" />
                </button>
              </div>

              {/* Cash and cheques carry nothing: there is nobody to send to. */}
              {needsDetail(entry.method) && (
                <div className="flex flex-col gap-1 pt-1.5 motion-safe:animate-in motion-safe:duration-200 motion-safe:fade-in-0">
                  <Label
                    className="text-2xs text-muted-foreground"
                    htmlFor={`payout-${entry.method}`}
                  >
                    {t(`${field}.label` as Parameters<typeof t>[0])}
                  </Label>
                  <PayoutDetailInput
                    id={`payout-${entry.method}`}
                    className="h-10 rounded-xl bg-wash-2 px-3"
                    method={entry.method}
                    value={entry.detail}
                    invalid={Boolean(error)}
                    describedBy={
                      error ? `payout-${entry.method}-error` : undefined
                    }
                    // Only the methods that name their own field say anything
                    // here; the rest are the field's own business, and a
                    // number's is its country's.
                    placeholder={
                      named
                        ? t(`${field}.placeholder` as Parameters<typeof t>[0])
                        : undefined
                    }
                    onChange={(detail) => edit(entry.method, detail)}
                    onBlur={() => commit(entry.method)}
                  />
                  {error && (
                    <p
                      id={`payout-${entry.method}-error`}
                      className="text-2xs text-destructive"
                    >
                      {error}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}

        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          aria-haspopup="dialog"
          className={cn(
            "flex min-h-13 w-full items-center gap-2.5 px-4 py-3 text-left transition-colors",
            "hover:bg-wash-1 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
            entries.length > 0 && "border-t border-border",
          )}
        >
          <span
            aria-hidden="true"
            className="flex size-6.5 shrink-0 items-center justify-center rounded-lg bg-primary/16 text-primary-ink"
          >
            <Plus className="size-3.5" strokeWidth={2.4} />
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-primary-ink">
            {t("addMethod")}
          </span>
        </button>
      </section>

      {errors.form && (
        <p className="shrink-0 px-1.5 text-xs text-destructive">
          {errors.form}
        </p>
      )}
      {pending && (
        <>
          <span className="sr-only" role="status">
            {tCommon("loading")}
          </span>
          <Loader2
            aria-hidden="true"
            className="mx-1.5 size-4 shrink-0 animate-spin text-muted-foreground"
          />
        </>
      )}

      {wantsAddress && <SwissAddress initial={initialAddress} />}

      <MethodPickerSheet
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        added={entries.map((entry) => entry.method)}
        onAdd={add}
      />
    </>
  );
}

/**
 * The postal address a Swiss QR-bill cannot be built without.
 *
 * It says who will see it, and that sentence is the point: the address travels
 * inside the QR code, so the person who owes money reads it when they scan.
 * That is how a bank transfer has always worked, and somebody should learn it
 * here rather than afterwards.
 *
 * Street and building number are genuinely optional in the standard and are
 * left so here. Postcode, town and country are not, so nothing is written
 * until all three are there — and the badge at the top says which of the two
 * states this is, rather than leaving somebody to find out at the moment they
 * are owed money.
 *
 * **A refusal is never dropped.** An address short of what the standard needs
 * writes nothing, and somebody told nothing goes away believing the QR code
 * they cannot see is a bug elsewhere. So a half-filled address says so, and a
 * rejected one says what the server said.
 */
function SwissAddress({ initial }: { initial: SwissCreditorAddress | null }) {
  const t = useTranslations("payouts");
  const tCommon = useTranslations("common");
  const [address, setAddress] = useState<SwissCreditorAddress>(
    initial ?? EMPTY_ADDRESS,
  );
  const [error, setError] = useState("");
  const [, startTransition] = useTransition();

  /*
   * What the account already holds, which is not what the fields show.
   *
   * An address is five fields and so five blurs, and every one of them would
   * otherwise send the whole address again and raise its own confirmation. It
   * is also what Undo goes back to, and null — never asked — is one of the
   * answers it has to be able to go back to.
   */
  const saved = useRef<SwissCreditorAddress | null>(initial);
  const complete = isCompleteAddress(address);

  const commit = () => {
    if (!complete) {
      // Silent while it is still empty: the card opened by itself with the
      // bank row, and nobody has typed anything to be wrong about yet.
      setError(isBlankAddress(address) ? "" : t("errors.address"));
      return;
    }

    setError("");
    if (sameAddress(address, saved.current)) return;

    const previous = saved.current;
    saved.current = address;
    startTransition(async () => {
      const result = await setPayoutAddressAction(address);
      if (!result.ok) {
        saved.current = previous;
        setError(result.error ?? t("saveFailed"));
        return;
      }
      toastUndoable(
        t("saved"),
        {
          label: tCommon("undo"),
          onUndo: () => {
            setAddress(previous ?? EMPTY_ADDRESS);
            saved.current = previous;
            startTransition(async () => {
              await setPayoutAddressAction(previous);
            });
          },
        },
        { id: "payout-address" },
      );
    });
  };

  const field = (
    key: keyof SwissCreditorAddress,
    label: string,
    props: {
      className?: string;
      placeholder?: string;
      autoComplete?: string;
      maxLength?: number;
      transform?: (value: string) => string;
    } = {},
  ) => (
    <div className={cn("flex flex-col gap-1", props.className)}>
      <Label
        className="text-2xs text-muted-foreground"
        htmlFor={`address-${key}`}
      >
        {label}
      </Label>
      <Input
        id={`address-${key}`}
        className="h-9.5 rounded-[11px] bg-wash-2 px-3"
        value={address[key] ?? ""}
        placeholder={props.placeholder}
        autoComplete={props.autoComplete}
        maxLength={props.maxLength}
        onChange={(event) =>
          setAddress({
            ...address,
            [key]: props.transform
              ? props.transform(event.target.value)
              : event.target.value,
          })
        }
        onBlur={commit}
      />
    </div>
  );

  return (
    <section className="flex shrink-0 flex-col gap-2.5 rounded-[20px] bg-card p-4 ring-1 ring-foreground/10 motion-safe:animate-in motion-safe:duration-[260ms] motion-safe:fade-in-0">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 text-sm font-semibold">{t("addressTitle")}</h2>
          <span
            className={cn(
              "shrink-0 rounded-full px-1.5 py-0.5 text-2xs font-semibold",
              complete
                ? "bg-positive/15 text-positive-ink"
                : "bg-wash-3 text-muted-foreground",
            )}
          >
            {complete ? t("addressReady") : t("addressIncomplete")}
          </span>
        </div>
        <p className="text-xs leading-relaxed text-pretty text-muted-foreground">
          {t("addressSub")}
        </p>
      </div>

      <div className="grid grid-cols-[1fr_84px] gap-2">
        {field("street", t("addressStreet"), {
          placeholder: t("addressStreetHint"),
          autoComplete: "address-line1",
          maxLength: 70,
        })}
        {field("buildingNumber", t("addressBuilding"), {
          placeholder: "12",
          autoComplete: "address-line2",
          maxLength: 16,
        })}
        {field("town", t("addressTown"), {
          placeholder: t("addressTownHint"),
          autoComplete: "address-level2",
          maxLength: 35,
        })}
        {field("postalCode", t("addressPostalCode"), {
          placeholder: "3920",
          autoComplete: "postal-code",
          maxLength: 16,
        })}
        {/*
          Two letters, and the field is built so that only two can be typed.
          The standard wants ISO 3166-1 alpha-2 and the server refuses anything
          else, so a box that accepted "Suisse" was a box that took an answer,
          kept it on screen and never wrote it. `country` — as against
          `country-name` — is the autofill token for the code itself.
        */}
        {field("country", t("addressCountry"), {
          className: "col-span-2",
          placeholder: t("addressCountryPlaceholder"),
          autoComplete: "country",
          maxLength: 2,
          transform: (value) => value.toUpperCase(),
        })}
      </div>

      {error && <p className="text-2xs text-destructive">{error}</p>}
    </section>
  );
}
