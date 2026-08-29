"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Plus, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addParticipantAction,
  createInvitationAction,
} from "@/modules/groups/actions";
import { cn } from "@/lib/utils";

/**
 * The last row of the People card: add someone else.
 *
 * It asks for a name and then for the only decision that actually follows —
 * whether this person needs a way in now. Choosing "Create a link" runs the
 * invitation immediately and hands the one-time reveal back to the card, so
 * adding a guest and giving them access is one pass rather than two visits to
 * the same list.
 */

const FIELD =
  "h-[42px] rounded-lg border-input bg-[color-mix(in_oklch,var(--input)_30%,transparent)] px-3 text-base md:text-sm";

export function AddPersonRow({
  groupId,
  open,
  onOpen,
  onClose,
  onAdded,
  canInvite,
}: {
  groupId: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  /** Someone was added and their link issued — show it on their row. */
  onAdded: (participantId: string, url: string) => void;
  canInvite: boolean;
}) {
  const t = useTranslations("membersPage");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [invite, setInvite] = useState<"link" | "later">("link");
  const [pending, setPending] = useState(false);

  const reset = () => {
    setName("");
    setEmail("");
    setInvite("link");
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-[58px] w-full items-center gap-2.5 p-3.5 text-left font-semibold text-primary-ink transition-colors hover:bg-[color-mix(in_oklch,var(--muted)_45%,transparent)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:-outline-offset-2 focus-visible:outline-none"
      >
        <span className="inline-flex size-[38px] shrink-0 items-center justify-center rounded-full border border-dashed border-[color-mix(in_oklch,var(--primary)_45%,transparent)]">
          <Plus aria-hidden="true" className="size-[17px]" />
        </span>
        {t("addSomeone")}
      </button>
    );
  }

  const onSubmit = async () => {
    const trimmed = name.trim();
    if (trimmed === "") return;

    setPending(true);
    try {
      const formData = new FormData();
      formData.set("displayName", trimmed);
      formData.set("email", email.trim());
      const added = await addParticipantAction(groupId, formData);
      if (!added.ok || !added.data) {
        toast.error(added.error ?? t("addFailed"));
        return;
      }

      // "Just add them" is done here; the other path owes them a way in.
      if (invite !== "link" || !canInvite) {
        reset();
        onClose();
        router.refresh();
        toast.success(t("addedNoAccess", { name: trimmed }));
        return;
      }

      const linkData = new FormData();
      linkData.set("participantId", added.data.participantId);
      linkData.set("expiresInDays", "never");
      const link = await createInvitationAction(groupId, linkData);
      router.refresh();
      if (!link.ok || !link.data) {
        // The person exists either way — say so, and leave the link for their
        // own row rather than pretending the whole gesture failed.
        reset();
        onClose();
        toast.error(link.error ?? t("createLinkFailed"));
        return;
      }
      reset();
      onAdded(added.data.participantId, link.data.url);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 bg-[color-mix(in_oklch,var(--muted)_42%,transparent)] p-3.5 motion-safe:animate-in motion-safe:duration-150 motion-safe:fade-in-0 motion-safe:slide-in-from-top-1">
      <span className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{t("addSomeone")}</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label={tCommon("cancel")}
          className="size-[34px] rounded-full text-muted-foreground"
          onClick={() => {
            reset();
            onClose();
          }}
          disabled={pending}
        >
          <X aria-hidden="true" />
        </Button>
      </span>

      <label htmlFor="add-person-name" className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">{t("name")}</span>
        <Input
          id="add-person-name"
          value={name}
          maxLength={120}
          autoFocus
          placeholder={t("namePlaceholder")}
          onChange={(event) => setName(event.target.value)}
          className={FIELD}
        />
      </label>

      <label htmlFor="add-person-email" className="flex flex-col gap-1.5">
        <span className="flex items-baseline gap-1.5 text-xs font-medium">
          {t("email")}
          <span className="text-xs font-normal text-muted-foreground">
            {tCommon("optional")}
          </span>
        </span>
        <Input
          id="add-person-email"
          type="email"
          inputMode="email"
          value={email}
          placeholder="name@example.com"
          onChange={(event) => setEmail(event.target.value)}
          className={FIELD}
        />
      </label>

      {canInvite && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="pb-1.5 text-xs font-medium">{t("then")}</legend>
          <span className="grid grid-cols-2 gap-2">
            <Choice
              selected={invite === "link"}
              onSelect={() => setInvite("link")}
              title={t("createALink")}
              description={t("createALinkHint")}
            />
            <Choice
              selected={invite === "later"}
              onSelect={() => setInvite("later")}
              title={t("justAddThem")}
              description={t("justAddThemHint")}
            />
          </span>
        </fieldset>
      )}

      <Button
        className="h-11 font-semibold"
        onClick={() => void onSubmit()}
        disabled={pending || name.trim() === ""}
      >
        {pending ? (
          <Loader2 aria-hidden="true" className="animate-spin" />
        ) : (
          <UserPlus aria-hidden="true" />
        )}
        {t("addPerson")}
      </Button>
    </div>
  );
}

function Choice({
  selected,
  onSelect,
  title,
  description,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "flex flex-col items-start gap-0.5 rounded-lg border p-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        selected
          ? "border-[color-mix(in_oklch,var(--primary)_45%,transparent)] bg-[color-mix(in_oklch,var(--primary)_10%,transparent)]"
          : "border-border hover:bg-[color-mix(in_oklch,var(--muted)_45%,transparent)]",
      )}
    >
      <span className="text-xs font-semibold">{title}</span>
      <span className="text-xs leading-[1.35] text-muted-foreground">
        {description}
      </span>
    </button>
  );
}
