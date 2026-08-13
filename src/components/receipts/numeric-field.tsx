"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

/**
 * A text field holding a number someone is editing.
 *
 * This exists because of a bug seen on a real phone: amounts on the review
 * screen gained digits at the *front* without anyone typing them — `24.00`
 * became `124.00`, then `624.00`. Two mechanisms produce exactly that, and
 * this closes both rather than guessing which one it was.
 *
 * **React rewriting the value mid-edit.** A controlled input re-renders on
 * every keystroke, and when the value React writes back differs at all from
 * what the DOM already holds, Safari on iOS can drop the caret to position
 * zero. The next character then lands at the start. So while the field has
 * focus, the value comes from local state — what the user typed, exactly —
 * and the parent is only *told* about changes. React never writes over it.
 * When focus leaves, the field re-syncs with whatever the parent now holds,
 * so a value changed from outside (accepting a suggested total) still lands.
 *
 * **The browser filling it in.** A numeric field with no `autocomplete` is
 * something Safari and password managers will volunteer values for. On a
 * field that decides what somebody pays, that is not a convenience.
 *
 * Money is the one place in this form where a silent, invisible edit is
 * unacceptable — the number would look plausible and be wrong.
 */
export function NumericField({
  value,
  onValueChange,
  inputMode = "decimal",
  ...rest
}: {
  value: string;
  onValueChange: (next: string) => void;
  inputMode?: "decimal" | "numeric";
} & Omit<
  React.ComponentProps<typeof Input>,
  "value" | "onChange" | "inputMode"
>) {
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);

  // Adopt outside changes only when the field is not being typed into.
  useEffect(() => {
    if (!editing.current) setDraft(value);
  }, [value]);

  return (
    <Input
      {...rest}
      inputMode={inputMode}
      value={draft}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      // Safari keys its own autofill heuristics off the name as much as the
      // type; anything resembling an amount invites it.
      name={rest.name ?? "receipt-value"}
      onFocus={(event) => {
        editing.current = true;
        rest.onFocus?.(event);
      }}
      onBlur={(event) => {
        editing.current = false;
        // Whatever the parent made of the last keystroke is now the truth.
        setDraft(value);
        rest.onBlur?.(event);
      }}
      onChange={(event) => {
        setDraft(event.target.value);
        onValueChange(event.target.value);
      }}
    />
  );
}
