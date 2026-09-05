"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { LogOut, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { ConfirmSheet } from "./confirm-sheet";
import { cn } from "@/lib/utils";
import { deleteAccountAction, signOutAction } from "@/modules/auth/actions";

/**
 * The two things on the Account screen that ask before they act.
 *
 * Everything else in settings writes as it is touched and offers Undo. These
 * two cannot: signing out ends the session the Undo would live in, and
 * deleting removes the account it would restore. So they stop and ask, and
 * they are the only things here that do — which is what keeps the question
 * meaningful when it is asked.
 *
 * Deleting asks for the address as well as the tap. Not as security — the
 * action re-checks the caller and the address itself, because a dialog is not
 * an authorization check — but as friction proportionate to the outcome. The
 * account is not recoverable, and typing it out is the difference between
 * meaning it and being halfway through something else.
 */
export function DangerCard({ email }: { email: string }) {
  const router = useRouter();
  const t = useTranslations("userSettings");

  const [signingOut, setSigningOut] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [typed, setTyped] = useState("");

  const confirmDelete = async () => {
    const result = await deleteAccountAction({ email: typed });
    if (!result.ok) {
      toast.error(result.error ?? t("deleteFailed"));
      return;
    }
    // The account and its session are gone; anything else this browser has
    // cached about them is about to be wrong.
    router.replace("/");
    router.refresh();
  };

  return (
    <>
      <section className="shrink-0 overflow-hidden rounded-xl bg-card text-card-foreground ring-1 ring-foreground/10">
        <DangerRow
          icon={LogOut}
          label={t("signOut")}
          onClick={() => setSigningOut(true)}
        />
        <DangerRow
          icon={Trash2}
          label={t("deleteAccount")}
          destructive
          onClick={() => {
            setTyped("");
            setDeleting(true);
          }}
        />
      </section>

      <ConfirmSheet
        open={signingOut}
        onOpenChange={setSigningOut}
        title={t("signOutTitle")}
        body={t("signOutBody")}
        confirmLabel={t("signOut")}
        onConfirm={() => signOutAction()}
      />

      <ConfirmSheet
        open={deleting}
        onOpenChange={setDeleting}
        title={t("deleteTitle")}
        body={t("deleteBody")}
        confirmLabel={t("delete")}
        destructive
        onConfirm={confirmDelete}
      >
        <div className="space-y-1.5">
          <label
            htmlFor="confirm-delete-email"
            className="block text-xs text-muted-foreground"
          >
            {t("deleteTypeEmail")}
          </label>
          <Input
            id="confirm-delete-email"
            type="email"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={email}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            className="h-10 rounded-xl"
          />
        </div>
      </ConfirmSheet>
    </>
  );
}

function DangerRow({
  icon: Icon,
  label,
  destructive,
  onClick,
}: {
  icon: typeof LogOut;
  label: string;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-11 w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-medium",
        "transition-colors hover:bg-wash-1 focus-visible:ring-3 focus-visible:ring-ring/50",
        "focus-visible:-outline-offset-2 focus-visible:outline-none",
        "not-first:border-t not-first:border-border",
        destructive && "text-destructive",
      )}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.9} />
      {label}
    </button>
  );
}
