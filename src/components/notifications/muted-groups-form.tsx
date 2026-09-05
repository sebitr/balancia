"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { setGroupMutedAction } from "@/modules/notifications/actions";

export interface MutableGroup {
  readonly id: string;
  readonly name: string;
  readonly muted: boolean;
}

/** Shown before the list asks to be opened out. */
const PREVIEW = 3;

/**
 * Per-group silence.
 *
 * A blunter instrument than the category switches and deliberately so: one
 * busy group is the usual reason people turn notifications off altogether,
 * and muting it is the smaller change.
 *
 * The switch reads as the group's voice rather than as its mute: on means it
 * can still reach you. Labelling it the other way round — a switch that is on
 * when the group is *silenced* — is how somebody ends up muting the four
 * groups they wanted to keep.
 *
 * Only the first three are drawn. Somebody with eleven groups is looking for
 * one of them, and eleven rows of switches under two other cards is a screen
 * that has stopped being scannable; the rest are one tap away.
 *
 * Silencing a group says nothing back. The switch moved, it stayed moved, and
 * flicking it again is the whole of the way back — which a toast would have
 * covered up the row to offer. A refusal is the exception, as everywhere: the
 * switch returns and the error is the one thing that has to be spoken.
 */
export function MutedGroupsForm({ groups }: { groups: MutableGroup[] }) {
  const t = useTranslations("notificationSettings");
  const tSettings = useTranslations("userSettings");
  const [state, setState] = useState(groups);
  const [expanded, setExpanded] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (state.length === 0) {
    return <p className="text-xs text-muted-foreground">{t("noGroups")}</p>;
  }

  const toggle = (groupId: string, muted: boolean) => {
    const previous = state;
    setState((current) =>
      current.map((group) =>
        group.id === groupId ? { ...group, muted } : group,
      ),
    );
    startTransition(async () => {
      const result = await setGroupMutedAction(groupId, muted);
      if (!result.ok) {
        setState(previous);
        toast.error(result.error ?? t("saveFailed"));
      }
    });
  };

  const shown = expanded ? state : state.slice(0, PREVIEW);

  return (
    <div>
      <ul className="space-y-3.5">
        {shown.map((group) => (
          <li key={group.id} className="flex min-h-11 items-center gap-4">
            <label
              htmlFor={`muted-${group.id}`}
              className="min-w-0 flex-1 truncate text-sm font-medium"
            >
              {group.name}
            </label>
            <Switch
              id={`muted-${group.id}`}
              size="lg"
              // On means it can still speak, so the switch is the inverse of
              // the stored flag.
              checked={!group.muted}
              disabled={isPending}
              onCheckedChange={(audible) => toggle(group.id, !audible)}
            />
          </li>
        ))}
      </ul>

      {state.length > PREVIEW && (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          className="-mx-4 mt-3.5 -mb-4 flex w-[calc(100%+2rem)] items-center border-t border-border px-4 py-3 text-xs font-semibold text-primary-ink transition-colors hover:bg-wash-1 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {expanded
            ? tSettings("showFewer")
            : tSettings("showAllGroups", { count: state.length })}
        </button>
      )}
    </div>
  );
}
