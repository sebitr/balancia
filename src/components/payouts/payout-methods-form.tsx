"use client";

import { useMemo, useState, useTransition } from "react";
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
    initialAddress ?? {
      street: "",
      buildingNumber: "",
      postalCode: "",
      town: "",
      country: "",
    },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

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

  /*
   * Whether an address is needed at all.
   *
   * Only the Swiss standard requires one, so only a Swiss IBAN is asked. A
   * German account gets a Girocode, which carries no address, and nobody is
   * asked where they live to be paid by TWINT.
   */
  const swissIban = entries.some(
    (entry) =>
      entry.method === "bank" &&
      /^(CH|LI)/i.test(entry.detail.replace(/\s/g, "")),
  );

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
              </div>
            )}
          </div>
        );
      })}

      {swissIban && (
        <SwissAddress
          address={address}
          onChange={setAddress}
          persist={persist}
        />
      )}

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
 * Shown only under a Swiss IBAN, and it says who will see it. That sentence is
 * the point: the address travels inside the QR code, so the person who owes
 * money reads it when they scan. That is how a bank transfer has always
 * worked, and somebody should learn it here rather than afterwards.
 *
 * Street and building number are genuinely optional in the standard and are
 * left so here. Postcode, town and country are not, so nothing is written
 * until all three are there — a half-filled address is one the QR would be
 * refused for.
 */
function SwissAddress({
  address,
  onChange,
  persist,
}: {
  address: SwissCreditorAddress;
  onChange: (address: SwissCreditorAddress) => void;
  persist: boolean;
}) {
  const t = useTranslations("payouts");

  const complete =
    (address.postalCode ?? "").trim().length > 0 &&
    (address.town ?? "").trim().length > 0 &&
    /^[A-Za-z]{2}$/.test((address.country ?? "").trim());

  const commit = () => {
    if (!persist || !complete) return;
    void setPayoutAddressAction(address);
  };

  const field = (
    key: keyof SwissCreditorAddress,
    label: string,
    className?: string,
  ) => (
    <div className={cn("flex flex-col gap-1", className)}>
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
        onChange={(event) =>
          onChange({ ...address, [key]: event.target.value })
        }
        onBlur={commit}
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
        {field("street", t("addressStreet"), "col-span-2")}
        {field("buildingNumber", t("addressBuilding"))}
        {field("postalCode", t("addressPostalCode"))}
        {field("town", t("addressTown"), "col-span-2")}
        {field("country", t("addressCountry"))}
      </div>
    </div>
  );
}
