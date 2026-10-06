"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Eye, EyeOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

/**
 * A password field with an eye that shows what was typed.
 *
 * It replaces the confirm field rather than sitting beside one. A confirm field
 * catches a typo by having somebody type the same thing twice, blind, and then
 * says only that the two differ; the eye lets them read the one they typed. On
 * a phone that is one field and one tap instead of two fields typed letter by
 * letter.
 *
 * The eye is a toggle button: its name stays "Show password" and
 * `aria-pressed` says whether it is on, which is how a screen reader announces
 * a two-state control without its label changing under it. A pointer press
 * does not take focus, so on a phone the keyboard stays up and the caret stays
 * where it was. The box is 32px, drawn inside the field, and `tap-target`
 * grows what a finger can hit to 44.
 *
 * `type` is not a prop: the eye owns it.
 */
function PasswordInput({
  className,
  id,
  disabled,
  ...props
}: Omit<React.ComponentProps<"input">, "type">) {
  const t = useTranslations("common");
  const [shown, setShown] = React.useState(false);
  const fallbackId = React.useId();
  const inputId = id ?? fallbackId;

  return (
    <div data-slot="password-input" className="relative">
      <Input
        id={inputId}
        type={shown ? "text" : "password"}
        disabled={disabled}
        // Typed passwords are not words: no capital forced onto the first
        // letter, and no correction swapping one for something in the
        // dictionary once it is visible.
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={cn("pr-11", className)}
        {...props}
      />
      <button
        type="button"
        aria-label={t("showPassword")}
        aria-pressed={shown}
        aria-controls={inputId}
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setShown((current) => !current)}
        className="tap-target absolute top-1/2 right-1.5 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 aria-pressed:text-foreground"
      >
        {shown ? (
          <EyeOff aria-hidden="true" className="size-4" />
        ) : (
          <Eye aria-hidden="true" className="size-4" />
        )}
      </button>
    </div>
  );
}

export { PasswordInput };
