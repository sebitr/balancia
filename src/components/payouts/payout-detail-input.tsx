"use client";

import type { ChangeEvent } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import {
  PAYOUT_DETAIL_MAX_LENGTH,
  payoutFieldFor,
} from "@/modules/payouts/fields";
import {
  countryForPayoutMethod,
  payoutExampleFor,
} from "@/modules/payouts/examples";
import { formatPhoneAsTyped } from "@/modules/payouts/format";
import { useViewerCountry } from "./use-viewer-country";

/**
 * The one field a payout method needs, wherever it is asked for.
 *
 * Both screens that ask — the settings card, and the sheet the onboarding puts
 * in front of somebody — built this input themselves, which is how they came
 * to disagree about what a phone number looks like. It is one component now,
 * and the two things it knows are the two things a call site kept getting
 * wrong:
 *
 *  - **The example belongs to the method's country.** Satispay is Italian; an
 *    empty Satispay field showing `+41 79 …` describes Switzerland to somebody
 *    who has never been paid there. `payoutExampleFor` decides that, and the
 *    catalogue is only asked about the details that look the same everywhere —
 *    a Revtag, an email address, a PayPal.me link.
 *  - **A number is grouped as it is typed**, by the numbering plan of the
 *    country the method belongs to.
 *
 * Two rules keep the grouping out of the way of the person typing. Nothing is
 * regrouped while the caret is anywhere but the end, because a space that
 * moves takes the caret with it and the next keystroke lands somewhere nobody
 * asked for. And nothing is regrouped on a deletion, because a separator that
 * reappears the instant it is deleted is a field that has taken the backspace
 * key away.
 */
export function PayoutDetailInput({
  id,
  method,
  value,
  placeholder,
  className,
  invalid,
  describedBy,
  onChange,
  onBlur,
}: {
  id: string;
  method: string;
  value: string;
  /**
   * The example to show when the detail is not country-shaped and the method
   * has a name for its own field — a Revtag, a Cashtag. Anything else falls
   * back to the one its kind carries.
   */
  placeholder?: string;
  className?: string;
  invalid?: boolean;
  describedBy?: string;
  onChange: (detail: string) => void;
  onBlur: () => void;
}) {
  const t = useTranslations("payouts");
  const kind = payoutFieldFor(method);
  const viewer = useViewerCountry();

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const field = event.target;
    const typed = field.value;
    if (kind !== "phone") {
      onChange(typed);
      return;
    }

    const inputType = (event.nativeEvent as InputEvent).inputType ?? "";
    const caret = field.selectionStart;
    const atEnd = caret === null || caret === typed.length;

    if (inputType.startsWith("delete")) {
      // The separator the deleted digit was sitting behind goes with it, so
      // that one press of backspace is one visible change. Only at the end:
      // in the middle of a number, what is deleted is exactly what was asked
      // for and nothing else.
      onChange(atEnd ? typed.replace(/\s+$/, "") : typed);
      return;
    }

    onChange(
      atEnd
        ? formatPhoneAsTyped(typed, countryForPayoutMethod(method, viewer))
        : typed,
    );
  };

  return (
    <Input
      id={id}
      className={className}
      value={value}
      maxLength={PAYOUT_DETAIL_MAX_LENGTH}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      inputMode={kind === "phone" ? "tel" : "text"}
      autoComplete={kind === "email" ? "email" : "off"}
      /*
       * `??` rather than a ternary, and the order matters: a phone number and
       * an IBAN have no placeholder in the catalogue — those two shapes are a
       * country's, not a language's, and live in `examples.ts` — so the
       * catalogue must never be asked for one.
       */
      placeholder={
        payoutExampleFor(method, viewer) ??
        placeholder ??
        t(`fields.${kind}.placeholder` as Parameters<typeof t>[0])
      }
      onChange={handleChange}
      onBlur={onBlur}
    />
  );
}
