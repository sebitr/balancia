"use client";

import { useId, type ComponentProps, type ReactNode } from "react";
import { ChevronDown, CircleAlert, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { cn } from "@/lib/utils";

/**
 * The few shapes of field and footer the four steps share.
 *
 * Every text field is `h-10 rounded-xl` with the label above it in `text-xs
 * font-semibold`, as the account screens draw theirs; the size of what is
 * typed is `Input`'s own `text-base md:text-sm`, and none of these override it.
 */

type InputExtras = Pick<
  ComponentProps<"input">,
  "inputMode" | "maxLength" | "required" | "disabled"
>;

const TECHNICAL = {
  autoCapitalize: "none",
  autoCorrect: "off",
  spellCheck: false,
} as const;

/**
 * What is wrong with a field, as words with a mark in front of them — colour
 * is never the only thing that says so.
 */
export function FieldError({
  id,
  children,
}: {
  id?: string;
  children: ReactNode;
}) {
  return (
    <p
      id={id}
      className="flex items-start gap-1.5 text-xs text-pretty text-destructive-ink"
    >
      <CircleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export function TextField({
  label,
  help,
  error,
  value,
  onChange,
  placeholder,
  autoComplete = "off",
  className,
  ...extras
}: {
  label: string;
  help?: string;
  /** Replaces the help while it is true; the field is marked invalid. */
  error?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  className?: string;
} & InputExtras) {
  const id = useId();
  const noteId = `${id}-note`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-semibold">
        {label}
      </label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-describedby={error || help ? noteId : undefined}
        aria-invalid={error ? true : undefined}
        className={cn("h-10 rounded-xl", className)}
        {...TECHNICAL}
        {...extras}
      />
      {error ? (
        <FieldError id={noteId}>{error}</FieldError>
      ) : (
        help && (
          <p id={noteId} className="text-xs text-pretty text-muted-foreground">
            {help}
          </p>
        )
      )}
    </div>
  );
}

export function SecretField({
  label,
  help,
  value,
  onChange,
  required,
}: {
  label: string;
  help?: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  const id = useId();
  const helpId = `${id}-help`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-semibold">
        {label}
      </label>
      <PasswordInput
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        // A password manager offering the account's own password for a
        // bucket's secret is a mistake waiting to be tapped.
        autoComplete="new-password"
        required={required}
        aria-describedby={help ? helpId : undefined}
        className="h-10 rounded-xl"
      />
      {help && (
        <p id={helpId} className="text-xs text-pretty text-muted-foreground">
          {help}
        </p>
      )}
    </div>
  );
}

/**
 * A native select. The list is short, and the platform's own picker beats
 * anything drawn here on a phone; `text-base` is not decoration, since Safari
 * zooms the page in on any select below 16px and never zooms back out.
 */
export function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-semibold">
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 w-full appearance-none rounded-xl border border-input bg-transparent px-3 pr-9 text-base transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none md:text-sm dark:bg-input/30"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
      </div>
    </div>
  );
}

/** A tick with its words beside it, the whole line being the target. */
export function CheckField({
  label,
  help,
  checked,
  onChange,
}: {
  label: string;
  help?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  const helpId = `${id}-help`;
  return (
    <div className="flex min-h-11 items-start gap-3 py-1.5">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(next) => onChange(next === true)}
        aria-describedby={help ? helpId : undefined}
        className="mt-0.5"
      />
      <div className="min-w-0 space-y-0.5">
        <label htmlFor={id} className="block text-sm font-medium text-pretty">
          {label}
        </label>
        {help && (
          <p id={helpId} className="text-xs text-pretty text-muted-foreground">
            {help}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The bottom of a step: the one filled button, and the way out beside it.
 *
 * Below `lg` the screen's arrow is the way back, and drawing a second one
 * under the thumb would only compete with the button that matters; from `lg`
 * the arrow is gone, so the way out is drawn here. It is in the document at
 * every width, hidden by CSS below `lg`, so that it is never missing for a
 * reader who has no arrow — a keyboard, a screen reader, a test.
 */
export interface FooterAction {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
}

export function StepFooter({
  secondary,
  primary,
  hint,
  note,
}: {
  secondary: FooterAction;
  primary: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    pending?: boolean;
  };
  /** Why the button is off, shown for as long as it is. */
  hint?: ReactNode;
  /** A line that is true whatever the button is doing. */
  note?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 lg:flex-row lg:justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={secondary.onClick}
          disabled={secondary.disabled}
          className="max-lg:hidden lg:min-w-28"
        >
          {secondary.label}
        </Button>
        <Button
          type="button"
          onClick={primary.onClick}
          disabled={primary.disabled || primary.pending}
          aria-busy={primary.pending || undefined}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className="w-full lg:w-auto lg:min-w-40"
        >
          {primary.pending && (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          )}
          {primary.label}
        </Button>
      </div>
      {hint && (
        <p
          id={`${id}-hint`}
          className="text-xs text-pretty text-muted-foreground lg:text-right"
        >
          {hint}
        </p>
      )}
      {note && (
        <p className="text-xs text-pretty text-muted-foreground lg:text-right">
          {note}
        </p>
      )}
    </div>
  );
}
