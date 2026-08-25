"use client";

import { useId, useRef } from "react";
import { cn } from "@/lib/utils";
import { CODE_LENGTH, normalizeCode } from "@/modules/auth/code-format";

/**
 * The six code boxes.
 *
 * Six boxes, one input. The boxes are drawn as `div`s and the thing that
 * actually holds the caret is a single transparent `input` stretched across
 * all of them — which is the whole trick, and the reason not to build this as
 * six inputs that forward focus to one another:
 *
 *  - iOS and Android offer a one-time code from the keyboard, and that only
 *    reaches a field declaring `autocomplete="one-time-code"`. Six of them
 *    means the offer fills box one with all six digits, or nothing at all.
 *  - Pasting works, because there is one value to paste into.
 *  - A password manager sees one field, not six.
 *  - Backspace, arrow keys and select-all behave the way they do in every
 *    other text field, because it *is* every other text field.
 *
 * The next empty box carries the coral border, so the eye has somewhere to be
 * without a blinking caret to follow — the caret itself is hidden, since it
 * would sit in the wrong place over a box that is only drawn.
 */
export function CodeInput({
  value,
  onChange,
  onComplete,
  label,
  disabled = false,
  autoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Fired when the sixth digit lands, so nobody has to reach for a button. */
  onComplete?: (value: string) => void;
  label: string;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const inputId = useId();
  const field = useRef<HTMLInputElement>(null);
  const digits = Array.from(
    { length: CODE_LENGTH },
    (_, index) => value[index] ?? "",
  );
  const cursor = Math.min(value.length, CODE_LENGTH - 1);

  return (
    <div className="relative">
      <label className="sr-only" htmlFor={inputId}>
        {label}
      </label>
      <div aria-hidden="true" className="grid grid-cols-6 gap-2">
        {digits.map((digit, index) => (
          <div
            key={index}
            className={cn(
              "flex h-14 items-center justify-center rounded-xl border bg-card text-xl font-semibold tabular-nums transition-colors",
              index === cursor && value.length < CODE_LENGTH
                ? "border-primary"
                : "border-input",
            )}
          >
            {digit}
          </div>
        ))}
      </div>
      <input
        ref={field}
        id={inputId}
        // `text-base` matters even on a field nobody can see: Safari zooms the
        // page in when a control under 16px takes focus, and never zooms back.
        className="absolute inset-0 h-full w-full text-base opacity-0 outline-none"
        style={{ caretColor: "transparent" }}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={CODE_LENGTH}
        onChange={(event) => {
          const next = normalizeCode(event.target.value);
          onChange(next);
          if (next.length === CODE_LENGTH) onComplete?.(next);
        }}
      />
    </div>
  );
}
