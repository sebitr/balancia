"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { toastUndoable } from "@/components/ui/sonner";
import { SettingsControlRow } from "@/components/settings/settings-row";
import { savePreferencesAction } from "@/modules/notifications/actions";
import type { NotificationPreferences } from "@/modules/notifications/types";

/**
 * The switches that decide what raises a notification at all.
 *
 * They govern the inbox as well as push: turning one off means Balancia does
 * not tell you about that kind of event, rather than telling you quietly.
 *
 * All five are on screen at once, with no "advanced" disclosure hiding the
 * last two. There are five of them; a disclosure would cost a tap to reveal
 * what a single glance can already take in, and the ones people actually want
 * to turn off — reminders, repeating expenses — are exactly the ones that
 * would end up behind it.
 */

/**
 * In the order somebody meets them: what other people do to your money first,
 * then what the system does on its own.
 */
const CATEGORIES = [
  { key: "expenses", label: "expenses", help: "expensesHelp" },
  { key: "settlements", label: "settlements", help: "settlementsHelp" },
  { key: "reminders", label: "reminders", help: "remindersHelp" },
  { key: "recurring", label: "recurring", help: "recurringHelp" },
  { key: "imports", label: "imports", help: "importsHelp" },
] as const;

export function NotificationPreferencesForm({
  defaultValue,
}: {
  defaultValue: NotificationPreferences;
}) {
  const t = useTranslations("notificationSettings");
  const tCommon = useTranslations("common");
  const [preferences, setPreferences] = useState(defaultValue);
  const [isPending, startTransition] = useTransition();

  const toggle = (
    key: keyof NotificationPreferences,
    value: boolean,
    announce = true,
  ) => {
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
      if (announce) {
        // Named for the switch rather than the card: flicking two of them
        // leaves two ways back, and flicking one twice replaces its own
        // confirmation instead of adding to a pile. Undoing says nothing —
        // the switch moving back is the answer.
        toastUndoable(
          t("saved"),
          { label: tCommon("undo"), onUndo: () => toggle(key, !value, false) },
          { id: `notify-${key}` },
        );
      }
    });
  };

  return (
    <div className="space-y-3.5">
      {CATEGORIES.map((category) => (
        <SettingsControlRow
          key={category.key}
          htmlFor={`notify-${category.key}`}
          label={t(category.label)}
          description={t(category.help)}
          control={
            <Switch
              id={`notify-${category.key}`}
              size="lg"
              checked={preferences[category.key]}
              disabled={isPending}
              onCheckedChange={(checked) => toggle(category.key, checked)}
            />
          }
        />
      ))}
    </div>
  );
}
