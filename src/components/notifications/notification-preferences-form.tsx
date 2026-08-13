"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { savePreferencesAction } from "@/modules/notifications/actions";
import type { NotificationPreferences } from "@/modules/notifications/types";

/**
 * The four switches that decide what raises a notification at all.
 *
 * They govern the inbox as well as push: turning one off means Balancia does
 * not tell you about that kind of event, rather than telling you quietly.
 */

const CATEGORIES = [
  { key: "expenses", label: "expenses", help: "expensesHelp" },
  { key: "settlements", label: "settlements", help: "settlementsHelp" },
  { key: "recurring", label: "recurring", help: "recurringHelp" },
  { key: "imports", label: "imports", help: "importsHelp" },
] as const;

export function NotificationPreferencesForm({
  defaultValue,
}: {
  defaultValue: NotificationPreferences;
}) {
  const t = useTranslations("notificationSettings");
  const [preferences, setPreferences] = useState(defaultValue);
  const [isPending, startTransition] = useTransition();

  const toggle = (key: keyof NotificationPreferences, value: boolean) => {
    const next = { ...preferences, [key]: value };
    // Optimistic: the switch should move under the finger, and a failure puts
    // it back rather than leaving it lying about the saved state.
    setPreferences(next);
    startTransition(async () => {
      const result = await savePreferencesAction(next);
      if (!result.ok) {
        setPreferences(preferences);
        toast.error(result.error ?? t("saveFailed"));
        return;
      }
      toast.success(t("saved"));
    });
  };

  return (
    <div className="space-y-4">
      {CATEGORIES.map((category) => (
        <div
          key={category.key}
          className="flex items-start justify-between gap-4"
        >
          <div className="space-y-1">
            <Label htmlFor={`notify-${category.key}`}>
              {t(category.label)}
            </Label>
            <p className="text-xs text-muted-foreground">{t(category.help)}</p>
          </div>
          <Switch
            id={`notify-${category.key}`}
            checked={preferences[category.key]}
            disabled={isPending}
            onCheckedChange={(checked) => toggle(category.key, checked)}
          />
        </div>
      ))}
    </div>
  );
}
