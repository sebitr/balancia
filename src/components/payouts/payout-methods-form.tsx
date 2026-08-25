"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toastUndoable } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import {
  setPayoutAddressAction,
  setPayoutMethodsAction,
} from "@/modules/payouts/actions";
import {
  needsDetail,
  payoutFieldFor,
  validatePayoutDetail,
  PAYOUT_DETAIL_MAX_LENGTH,
} from "@/modules/payouts/fields";
import {
  countryForTimezone,
  methodsForCountry,
  type PaymentMethodId,
} from "@/modules/settlements/payment-methods";
import type { SwissCreditorAddress } from "@/modules/payouts/qr/swiss";

/**
 * How people pay you back, as a list you tick.
 *
 * Multi-select rather than one choice, and ordered: whoever owes money is
 * shown the top one, so the order is an answer rather than a preference. Each
 * ticked method opens the one field it needs, and which field that is comes
 * from `payouts/fields.ts` — a phone number for TWINT, an IBAN for a transfer,
 * a Revtag for Revolut.
 *
 * **This one waits.** Everywhere else in settings a tap is written in the
 * background and never reports failure, because the worst case is a preference
 * that does not follow somebody to their next device. Here the worst case is
 * an IBAN that was never stored, discovered by the money not arriving — so a
 * detail is validated before it is sent, the send is awaited, and a refusal
 * comes back naming the row it belongs to.
 *
 * A detail saves when the field is left rather than on every keystroke: an
 * IBAN is invalid for the whole time it is being typed, and a checker that
 * shouts through all of it is one people learn to ignore.
 */

export interface PayoutEntry {
  readonly method: string;
  readonly detail: string;
}

export function PayoutMethodsForm({
  initial,
  initialAddress = null,
  confirmations = "toast",
  persist = true,
  onChange,
}: {
  initial: readonly PayoutEntry[];
  /** Only ever set, and only ever asked for, alongside a Swiss IBAN. */
  initialAddress?: SwissCreditorAddress | null;
  /**
   * False for a guest, who has no account to store any of this on. The list
   * still works for the length of the visit — the same bargain everything else
   * a guest does makes — and nothing is sent.
   */
  persist?: boolean;
  /**
   * Inside a sheet this is `"silent"`. A toast raised under an open sheet is
   * painted behind it and its Undo takes no taps, which is worse than no
   * confirmation at all.
   */
  confirmations?: "toast" | "silent";
  /** Lets a host screen reflect the list without owning it. */
  onChange?: (entries: readonly PayoutEntry[]) => void;
}) {
  const t = useTranslations("payouts");
  const tMethods = useTranslations("paymentMethods");
  const tCommon = useTranslations("common");

  const [entries, setEntries] = useState<readonly PayoutEntry[]>(initial);
  const [address, setAddress] = useState<SwissCreditorAddress>(
    initialAddress ?? EMPTY_ADDRESS,
  );
  const [addressError, setAddressError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  /*
   * What the account already holds, which is not what the fields show.
   *
   * An address is five fields and so five blurs, and every one of them would
   * otherwise send the whole address again and raise its own confirmation. It
   * is also what Undo goes back to, and null — never asked — is one of the
   * answers it has to be able to go back to.
   */
  const savedAddress = useRef<SwissCreditorAddress | null>(initialAddress);

  /*
   * The methods to offer, most likely first.
   *
   * From the phone's own timezone, which is the best country signal there is
   * before anybody has been asked anything — better than the currency, which
   * says nothing (EUR spans twenty countries), and better than one more
   * question. Anything already saved is shown whether or not the region
   * suggests it.
   */
  const offered = useMemo(() => {
    const timezone =
      typeof Intl === "undefined"
        ? null
        : Intl.DateTimeFormat().resolvedOptions().timeZone;
    const regional = methodsForCountry(countryForTimezone(timezone));
    const saved = initial.map((entry) => entry.method as PaymentMethodId);
    return [...new Set([...saved, ...regional])];
  }, [initial]);

  const save = (
    next: readonly PayoutEntry[],
    previous: readonly PayoutEntry[],
  ) => {
    if (!persist) return;
    startTransition(async () => {
      const result = await setPayoutMethodsAction({ methods: next });
      if (!result.ok) {
        // Put the list back: a row showing a detail the account did not keep
        // is worse than no confirmation at all.
        setEntries(previous);
        onChange?.(previous);
        setErrors((current) => ({
          ...current,
          form: result.error ?? t("saveFailed"),
        }));
        return;
      }
      setErrors((current) => ({ ...current, form: "" }));
      if (confirmations === "toast") {
        toastUndoable(
          t("saved"),
          {
            label: tCommon("undo"),
            onUndo: () => {
              setEntries(previous);
              onChange?.(previous);
              startTransition(async () => {
                await setPayoutMethodsAction({ methods: previous });
              });
            },
          },
          { id: "payout-methods" },
        );
      }
    });
  };

  const toggle = (method: string) => {
    const previous = entries;
    const next = entries.some((entry) => entry.method === method)
      ? entries.filter((entry) => entry.method !== method)
      : [...entries, { method, detail: "" }];
    setEntries(next);
    onChange?.(next);

    // Ticking a method that needs a detail saves nothing yet — there is
    // nothing to save, and the row would be refused. Unticking one, and
    // ticking cash, are complete facts on their own.
    const complete = next.every(
      (entry) => !validatePayoutDetail(entry.method, entry.detail),
    );
    if (complete) save(next, previous);
  };

  const edit = (method: string, detail: string) => {
    const next = entries.map((entry) =>
      entry.method === method ? { ...entry, detail } : entry,
    );
    setEntries(next);
    onChange?.(next);
    // Clear the complaint while they are fixing it; it comes back on blur.
    setErrors((current) => ({ ...current, [method]: "" }));
  };

  const commit = (method: string) => {
    const entry = entries.find((candidate) => candidate.method === method);
    if (!entry) return;

    const problem = validatePayoutDetail(method, entry.detail);
    if (problem) {
      setErrors((current) => ({
        ...current,
        [method]: t(`errors.${problem}` as Parameters<typeof t>[0]),
      }));
      return;
    }
    setErrors((current) => ({ ...current, [method]: "" }));
    // Everything else has to be valid too, or the whole write is refused.
    if (entries.every((one) => !validatePayoutDetail(one.method, one.detail))) {
      save(entries, initial);
    }
  };

  /**
   * Writes the address, once there is a whole one to write.
   *
   * Refusals used to be dropped on the floor here, which is the one thing this
   * block must not do: an address short of what the standard needs writes
   * nothing, and somebody who is told nothing goes away believing the QR code
   * they cannot see is a bug elsewhere. So a half-filled address says so, and
   * a rejected one says what the server said.
   */
  const saveAddress = () => {
    if (!persist) return;

    if (!isCompleteAddress(address)) {
      // Silent while it is still empty: the block opened by itself under a
      // Swiss IBAN, and nobody has typed anything to be wrong about yet.
      setAddressError(isBlankAddress(address) ? "" : t("errors.address"));
      return;
    }

    setAddressError("");
    if (sameAddress(address, savedAddress.current)) return;

    const previous = savedAddress.current;
    savedAddress.current = address;
    startTransition(async () => {
      const result = await setPayoutAddressAction(address);
      if (!result.ok) {
        savedAddress.current = previous;
        setAddressError(result.error ?? t("saveFailed"));
        return;
      }
      if (confirmations === "toast") {
        toastUndoable(
          t("saved"),
          {
            label: tCommon("undo"),
            onUndo: () => {
              setAddress(previous ?? EMPTY_ADDRESS);
              savedAddress.current = previous;
              startTransition(async () => {
                await setPayoutAddressAction(previous);
              });
            },
          },
          { id: "payout-address" },
        );
      }
    });
  };

  return (
    <div className="flex flex-col gap-1">
      {offered.map((id) => {
        const entry = entries.find((candidate) => candidate.method === id);
        const label = tMethods(id as Parameters<typeof tMethods>[0]);
        const kind = payoutFieldFor(id);
        const error = errors[id];

        return (
          <div key={id} className="flex flex-col">
            <button
              type="button"
              role="checkbox"
              aria-checked={Boolean(entry)}
              onClick={() => toggle(id)}
              className={cn(
                "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                entry ? "bg-primary/6" : "hover:bg-muted",
              )}
            >
              <span className="min-w-0 flex-1 text-sm">{label}</span>
              <Check
                aria-hidden="true"
                className={cn(
                  "size-4 shrink-0 transition-colors",
                  entry ? "text-primary" : "text-transparent",
                )}
              />
            </button>

            {entry && needsDetail(id) && (
              <div className="flex flex-col gap-1 px-3 pb-2">
                <Label
                  className="text-2xs text-muted-foreground"
                  htmlFor={`payout-${id}`}
                >
                  {t(`fields.${kind}.label` as Parameters<typeof t>[0])}
                </Label>
                <Input
                  id={`payout-${id}`}
                  className="h-11"
                  value={entry.detail}
                  maxLength={PAYOUT_DETAIL_MAX_LENGTH}
                  aria-invalid={Boolean(error)}
                  inputMode={kind === "phone" ? "tel" : "text"}
                  autoComplete={kind === "email" ? "email" : "off"}
                  placeholder={t(
                    `fields.${kind}.placeholder` as Parameters<typeof t>[0],
                  )}
                  onChange={(event) => edit(id, event.target.value)}
                  onBlur={() => commit(id)}
                />
                {error && <p className="text-xs text-destructive">{error}</p>}

                {/* Inside the row it belongs to rather than under the whole
                    list: it is part of answering "pay me by transfer", and at
                    the bottom of the card it read as a sixth payment method
                    that had lost its tickbox. */}
                {id === "bank" && isSwissIban(entry.detail) && (
                  <SwissAddress
                    address={address}
                    onChange={setAddress}
                    onCommit={saveAddress}
                    error={addressError}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}

      {errors.form && (
        <p className="px-3 pt-1 text-sm text-destructive">{errors.form}</p>
      )}
      {pending && (
        <span className="sr-only" role="status">
          {tCommon("loading")}
        </span>
      )}
      {pending && (
        <Loader2
          aria-hidden="true"
          className="mx-3 size-4 animate-spin text-muted-foreground"
        />
      )}
    </div>
  );
}

/**
 * The postal address a Swiss QR-bill cannot be built without.
 *
 * Shown under the IBAN that needs it, and it says who will see it. That
 * sentence is the point: the address travels inside the QR code, so the person
 * who owes money reads it when they scan. That is how a bank transfer has
 * always worked, and somebody should learn it here rather than afterwards.
 *
 * Street and building number are genuinely optional in the standard and are
 * left so here. Postcode, town and country are not, so nothing is written
 * until all three are there — a half-filled address is one the QR would be
 * refused for. The host says so when that is why nothing was written; this
 * only lays the fields out and reports when one is left.
 */
function SwissAddress({
  address,
  onChange,
  onCommit,
  error,
}: {
  address: SwissCreditorAddress;
  onChange: (address: SwissCreditorAddress) => void;
  /** A field was left. Whether that is worth a write is the host's call. */
  onCommit: () => void;
  error?: string;
}) {
  const t = useTranslations("payouts");

  const field = (
    key: keyof SwissCreditorAddress,
    label: string,
    props: {
      className?: string;
      /** What the browser should offer to fill it with. */
      autoComplete: string;
      maxLength?: number;
      placeholder?: string;
      /** Applied as it is typed, so what is stored is what is on screen. */
      transform?: (value: string) => string;
    },
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
        className="h-11"
        value={address[key] ?? ""}
        autoComplete={props.autoComplete}
        maxLength={props.maxLength}
        placeholder={props.placeholder}
        aria-invalid={Boolean(error)}
        onChange={(event) =>
          onChange({
            ...address,
            [key]: props.transform
              ? props.transform(event.target.value)
              : event.target.value,
          })
        }
        onBlur={onCommit}
      />
    </div>
  );

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-xl bg-muted/50 p-3">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t("addressTitle")}</span>
        <span className="text-xs text-pretty text-muted-foreground">
          {t("addressSub")}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {field("street", t("addressStreet"), {
          className: "col-span-2",
          autoComplete: "address-line1",
        })}
        {field("buildingNumber", t("addressBuilding"), {
          autoComplete: "address-line2",
          maxLength: 16,
        })}
        {field("postalCode", t("addressPostalCode"), {
          autoComplete: "postal-code",
          maxLength: 16,
        })}
        {field("town", t("addressTown"), {
          className: "col-span-2",
          autoComplete: "address-level2",
          maxLength: 35,
        })}
        {/*
          Two letters, and the field is built so that only two can be typed.
          The standard wants ISO 3166-1 alpha-2 and the server refuses anything
          else, so a box that accepted "Suisse" was a box that took an answer,
          kept it on screen and never wrote it. `country` — as against
          `country-name` — is the autofill token for the code itself.
        */}
        {field("country", t("addressCountry"), {
          autoComplete: "country",
          maxLength: 2,
          placeholder: t("addressCountryPlaceholder"),
          transform: (value) => value.toUpperCase(),
        })}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** What "no address" looks like in the fields; the account holds null. */
const EMPTY_ADDRESS: SwissCreditorAddress = {
  street: "",
  buildingNumber: "",
  postalCode: "",
  town: "",
  country: "",
};

const ADDRESS_FIELDS = [
  "street",
  "buildingNumber",
  "postalCode",
  "town",
  "country",
] as const;

/**
 * Whether an address is needed at all.
 *
 * Only the Swiss standard requires one, so only a Swiss IBAN is asked. A
 * German account gets a Girocode, which carries no address, and nobody is
 * asked where they live to be paid by TWINT.
 */
function isSwissIban(detail: string): boolean {
  return /^(CH|LI)/i.test(detail.replace(/\s/g, ""));
}

/** The three the standard will not build a code without. */
function isCompleteAddress(address: SwissCreditorAddress): boolean {
  return (
    address.postalCode.trim().length > 0 &&
    address.town.trim().length > 0 &&
    /^[A-Za-z]{2}$/.test(address.country.trim())
  );
}

function isBlankAddress(address: SwissCreditorAddress): boolean {
  return ADDRESS_FIELDS.every((key) => (address[key] ?? "").trim() === "");
}

function sameAddress(
  address: SwissCreditorAddress,
  saved: SwissCreditorAddress | null,
): boolean {
  if (!saved) return false;
  return ADDRESS_FIELDS.every(
    (key) => (address[key] ?? "").trim() === (saved[key] ?? "").trim(),
  );
}
