"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { setGroupMutedAction } from "@/modules/notifications/actions";

export interface MutableGroup {
  readonly id: string;
  readonly name: string;
  readonly muted: boolean;
}

/**
 * Per-group silence.
 *
 * A blunter instrument than the category switches and deliberately so: one
 * busy group is the usual reason people turn notifications off altogether,
 * and muting it is the smaller change.
 */
export function MutedGroupsForm({ groups }: { groups: MutableGroup[] }) {
  const t = useTranslations("notificationSettings");
  const [state, setState] = useState(groups);
  const [isPending, startTransition] = useTransition();

  if (state.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("noGroups")}</p>;
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
        return;
      }
      toast.success(t("saved"));
    });
  };

  return (
    <ul className="divide-y">
      {state.map((group) => (
        <li
          key={group.id}
          className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
        >
          <span className="flex items-center gap-2 text-sm">
            {group.name}
            {group.muted && <Badge variant="secondary">{t("muted")}</Badge>}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={() => toggle(group.id, !group.muted)}
          >
            {group.muted ? t("unmute") : t("mute")}
          </Button>
        </li>
      ))}
    </ul>
  );
}
