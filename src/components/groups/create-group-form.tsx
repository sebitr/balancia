"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { CurrencySelect } from "@/components/money/currency-select";
import { TimezoneSelect } from "@/components/groups/timezone-select";
import { ParticipantNamesField } from "@/components/groups/participant-names-field";
import { createGroupAction } from "@/modules/groups/actions";
import type { CurrencyMode } from "@/modules/currencies/conversion";

/**
 * Group creation.
 *
 * The currency-mode choice is the one decision that is awkward to change
 * later, so both options are spelled out rather than hidden behind a toggle.
 */
export function CreateGroupForm({
  defaultName,
  defaultTimezone,
}: {
  defaultName: string;
  defaultTimezone: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<CurrencyMode>("separate");
  const [ownerName, setOwnerName] = useState(defaultName);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (formData: FormData) => {
    setError(null);
    setPending(true);
    try {
      const result = await createGroupAction(formData);
      if (!result.ok || !result.data) {
        setError(result.error ?? "The group could not be created.");
        return;
      }
      toast.success("Group created");
      router.push(`/groups/${result.data.groupId}`);
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  return (
    <form action={onSubmit} className="space-y-6" noValidate>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="name">Group name</Label>
        <Input
          id="name"
          name="name"
          required
          maxLength={120}
          placeholder="Lisbon trip"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">
          Description{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id="description"
          name="description"
          maxLength={2000}
          rows={2}
          placeholder="Four days, three people, too much pastry."
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="ownerDisplayName">Your name in this group</Label>
        <Input
          id="ownerDisplayName"
          name="ownerDisplayName"
          value={ownerName}
          onChange={(event) => setOwnerName(event.target.value)}
          required
          maxLength={120}
        />
        <p className="text-xs text-muted-foreground">
          This is how you appear to everyone else in the group.
        </p>
      </div>

      <ParticipantNamesField ownerLabel={ownerName} />

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">
          How to handle currencies
        </legend>
        <RadioGroup
          name="currencyMode"
          value={mode}
          onValueChange={(value) => setMode(value as CurrencyMode)}
          className="gap-3"
        >
          <label
            htmlFor="mode-separate"
            className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/40 has-[:checked]:border-primary has-[:checked]:bg-accent/60"
          >
            <RadioGroupItem
              value="separate"
              id="mode-separate"
              className="mt-0.5"
            />
            <span className="space-y-1">
              <span className="block text-sm font-medium">
                Keep currencies separate
              </span>
              <span className="block text-sm text-muted-foreground">
                Each currency gets its own balance. Nothing is converted, so no
                exchange rate can ever distort what someone owes.
              </span>
            </span>
          </label>

          <label
            htmlFor="mode-converted"
            className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/40 has-[:checked]:border-primary has-[:checked]:bg-accent/60"
          >
            <RadioGroupItem
              value="converted"
              id="mode-converted"
              className="mt-0.5"
            />
            <span className="space-y-1">
              <span className="block text-sm font-medium">
                Convert to one base currency
              </span>
              <span className="block text-sm text-muted-foreground">
                Foreign expenses are converted using a rate you enter, frozen at
                the moment you record them. One balance for the whole group.
              </span>
            </span>
          </label>
        </RadioGroup>
      </fieldset>

      {mode === "converted" && (
        <div className="space-y-2">
          <Label htmlFor="baseCurrency">Base currency</Label>
          <CurrencySelect
            id="baseCurrency"
            name="baseCurrency"
            defaultValue="EUR"
            required
          />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="timezone">Group timezone</Label>
        <TimezoneSelect
          id="timezone"
          name="timezone"
          defaultValue={defaultTimezone}
        />
        <p className="text-xs text-muted-foreground">
          Used to decide when recurring expenses are due.
        </p>
      </div>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
        Create group
      </Button>
    </form>
  );
}
