"use client";

import { useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The people in a group, named while creating it.
 *
 * This exists so the answer to "do they need an account?" is demonstrated
 * rather than explained: you type three names, and three people are in the
 * group. Nobody is emailed, nobody is asked to sign up, and a guest link can
 * follow later for whoever actually wants to open the app.
 *
 * Each name is submitted as its own `participantNames` field, so the form
 * still works if this component never hydrates.
 */
export function ParticipantNamesField({
  ownerLabel,
}: {
  /** The creator's own name, shown as the first row so the list reads true. */
  ownerLabel: string;
}) {
  const [names, setNames] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const add = () => {
    const value = draft.trim();
    if (value === "") return;
    setNames((current) => [...current, value]);
    setDraft("");
    inputRef.current?.focus();
  };

  const remove = (index: number) => {
    setNames((current) => current.filter((_, position) => position !== index));
  };

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">
        Who else is in this group?
      </legend>

      <ul className="divide-y rounded-lg border">
        <li className="flex items-center gap-3 p-3 text-sm">
          <span className="flex-1 truncate">{ownerLabel || "You"}</span>
          <span className="shrink-0 text-xs text-muted-foreground">You</span>
        </li>
        {names.map((name, index) => (
          <li
            // Names can repeat, so the index is the only stable identity here.
            key={`${name}-${index}`}
            className="flex items-center gap-3 p-3 text-sm"
          >
            <span className="flex-1 truncate">{name}</span>
            <input type="hidden" name="participantNames" value={name} />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              // 44px target: this sits next to a text row on a phone.
              className="size-11 shrink-0"
              onClick={() => remove(index)}
            >
              <X aria-hidden="true" />
              <span className="sr-only">Remove {name}</span>
            </Button>
          </li>
        ))}
      </ul>

      {/* Stacked on a phone so neither the field nor the button is cramped. */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="flex-1 space-y-2">
          <Label htmlFor="participantName" className="sr-only">
            Add a person
          </Label>
          <Input
            id="participantName"
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter adds a person; it must not submit the whole form.
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
            maxLength={120}
            placeholder="Their name"
            autoComplete="off"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={add}
          disabled={draft.trim() === ""}
        >
          <Plus aria-hidden="true" />
          Add
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        They do not need an account. Add them now and send whoever wants to use
        the app a link later — you can add or rename people at any time.
      </p>
    </fieldset>
  );
}
