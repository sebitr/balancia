"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { toastUndoable } from "@/components/ui/sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  removeParticipantAction,
  restoreParticipantAction,
} from "@/modules/groups/actions";
import { AddPersonRow } from "./add-person-row";
import { PersonRow } from "./person-row";

/**
 * The People card: one row per person, one row to add another.
 *
 * The screen's shared state lives here rather than in the rows — which row is
 * open, and which freshly-created link is on screen. Both are exclusive by
 * nature: an accordion has one open panel, and a one-time link that stayed
 * visible while you went to read someone else's row would be a link left lying
 * around. Opening any row therefore closes the previous one and drops the
 * reveal.
 *
 * Removal is owned here too, because its confirmation and its undo both belong
 * to the screen rather than to the row that is about to disappear.
 */

export interface PersonView {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly isOwner: boolean;
  /** `account` signs in, `link` holds a live invite, `none` has neither. */
  readonly access: "account" | "link" | "none";
  readonly link: {
    readonly createdAt: string;
    readonly expiresAt: string | null;
    readonly lastUsedAt: string | null;
  } | null;
  /**
   * What this person is not square in, per currency, in minor units. The
   * engine's sign convention: negative means they owe the group.
   */
  readonly balances: readonly { minorUnits: string; currency: string }[];
}

export function PeopleCard({
  groupId,
  people,
  viewerId,
  canManage,
  canInvite,
  canRemove,
}: {
  groupId: string;
  people: readonly PersonView[];
  /** The reader's own participant row, so their row can offer what only they may do. */
  viewerId: string | null;
  canManage: boolean;
  canInvite: boolean;
  canRemove: boolean;
}) {
  const router = useRouter();
  const t = useTranslations("membersPage");
  const tCommon = useTranslations("common");
  const [openId, setOpenId] = useState<string | null>(null);
  const [reveal, setReveal] = useState<{ id: string; url: string } | null>(
    null,
  );
  const [adding, setAdding] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const open = (id: string | null) => {
    setOpenId(id);
    setReveal(null);
  };

  const toggle = (id: string) => {
    open(openId === id ? null : id);
    setAdding(false);
  };

  /** Lands straight on the one-time reveal for someone just added. */
  const openWithLink = (id: string, url: string) => {
    setAdding(false);
    setOpenId(id);
    setReveal({ id, url });
  };

  const confirming = people.find((person) => person.id === confirmId) ?? null;

  const onRemove = async (person: PersonView) => {
    setPending(true);
    try {
      const result = await removeParticipantAction(groupId, person.id);
      if (!result.ok) {
        toast.error(result.error ?? t("removeFailed"));
        return;
      }
      setConfirmId(null);
      if (openId === person.id) open(null);
      router.refresh();
      toastUndoable(t("removed", { name: person.name }), {
        label: tCommon("undo"),
        onUndo: () => onRestore(person),
      });
    } finally {
      setPending(false);
    }
  };

  const onRestore = async (person: PersonView) => {
    const result = await restoreParticipantAction(groupId, person.id);
    if (!result.ok) {
      toast.error(result.error ?? t("restoreFailed"));
      return;
    }
    router.refresh();
    toast.success(t("restored", { name: person.name }));
  };

  return (
    <>
      <div className="overflow-hidden rounded-[17px] bg-card ring-1 ring-[color-mix(in_oklch,var(--foreground)_10%,transparent)]">
        {people.map((person) => (
          <PersonRow
            key={person.id}
            groupId={groupId}
            person={person}
            isOpen={openId === person.id}
            onToggle={() => toggle(person.id)}
            revealUrl={reveal?.id === person.id ? reveal.url : null}
            onReveal={(url) => setReveal({ id: person.id, url })}
            onDismissReveal={() => setReveal(null)}
            onAskRemove={() => setConfirmId(person.id)}
            isSelf={person.id === viewerId}
            canManage={canManage}
            canInvite={canInvite}
            canRemove={canRemove}
          />
        ))}

        {canManage && (
          <AddPersonRow
            groupId={groupId}
            open={adding}
            onOpen={() => {
              setAdding(true);
              open(null);
            }}
            onClose={() => setAdding(false)}
            onAdded={openWithLink}
            canInvite={canInvite}
          />
        )}
      </div>

      <Sheet
        open={confirming !== null}
        onOpenChange={(next) => {
          if (!next) setConfirmId(null);
        }}
      >
        <SheetContent side="bottom" showCloseButton={false} className="gap-3.5">
          <SheetHeader className="gap-1.5 pb-0">
            <SheetTitle className="text-base font-semibold tracking-[-0.015em]">
              {t("removeTitle", { name: confirming?.name ?? "" })}
            </SheetTitle>
            <SheetDescription className="text-pretty">
              {t("removeBody")}
            </SheetDescription>
          </SheetHeader>
          <SheetFooter className="flex-row justify-end pt-0">
            <Button
              variant="outline"
              className="h-[42px] px-3.5"
              onClick={() => setConfirmId(null)}
              disabled={pending}
            >
              {t("keepThem")}
            </Button>
            <Button
              variant="destructive"
              className="h-[42px] px-3.5 font-semibold"
              onClick={() => confirming && void onRemove(confirming)}
              disabled={pending}
            >
              {t("remove")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
