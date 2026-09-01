"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmSheet } from "./confirm-sheet";
import {
  changePasswordAction,
  unlinkAppleAction,
} from "@/modules/auth/actions";
import { APPLE_START_PATH } from "@/modules/auth/apple-paths";
import { cn } from "@/lib/utils";

/**
 * The ways in that are not a passkey.
 *
 * Both rows read the same way — what it is, what state it is in, and one pill
 * that changes that state — because from the reader's side they are the same
 * kind of thing: a second way into the account for the day the first one is
 * not to hand.
 *
 * A password that does not exist yet cannot be changed here. `changePassword`
 * has nothing to check a request against, so a passkey-only account is sent
 * down the reset path instead, which proves the address before it sets
 * anything. That is a link rather than a pill, because it leaves the screen.
 */
export function FallbacksCard({
  hasPassword,
  appleEnabled,
  appleLinked,
}: {
  hasPassword: boolean;
  appleEnabled: boolean;
  appleLinked: boolean;
}) {
  const t = useTranslations("userSettings");
  const [changing, setChanging] = useState(false);

  return (
    <section className="shrink-0 overflow-hidden rounded-xl bg-card text-card-foreground ring-1 ring-foreground/10">
      <div className="flex items-start justify-between gap-3 px-4 py-3.5">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium">{t("password")}</p>
          <p className="text-xs text-pretty text-muted-foreground">
            {hasPassword ? t("passwordHelp") : t("passwordNotSet")}
          </p>
        </div>
        {hasPassword ? (
          <Pill onClick={() => setChanging((open) => !open)}>
            {changing ? t("cancel") : t("change")}
          </Pill>
        ) : (
          <Pill asLink href="/forgot-password">
            {t("passwordSet")}
          </Pill>
        )}
      </div>

      {changing && <PasswordForm onDone={() => setChanging(false)} />}

      {appleEnabled && <AppleRow linked={appleLinked} />}
    </section>
  );
}

/** Current and new, in the order the reader will type them. */
function PasswordForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations("userSettings");
  const tErrors = useTranslations("auth.errors");
  const fieldId = useId();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await changePasswordAction({
        currentPassword: current,
        newPassword: next,
      });
      if (!result.ok) {
        toast.error(result.error ?? tErrors("generic"));
        return;
      }
      toast.success(t("passwordChanged"));
      setCurrent("");
      setNext("");
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="space-y-2.5 border-t border-border px-4 py-3.5"
    >
      <Input
        id={`${fieldId}-current`}
        type="password"
        autoComplete="current-password"
        value={current}
        onChange={(event) => setCurrent(event.target.value)}
        aria-label={t("passwordCurrent")}
        placeholder={t("passwordCurrent")}
        className="h-10 rounded-xl"
      />
      <Input
        id={`${fieldId}-new`}
        type="password"
        autoComplete="new-password"
        value={next}
        onChange={(event) => setNext(event.target.value)}
        aria-label={t("passwordNew")}
        placeholder={t("passwordNew")}
        className="h-10 rounded-xl"
      />
      <Button
        type="submit"
        disabled={busy || current.length === 0 || next.length < 10}
        className="h-10 w-full rounded-xl text-sm"
      >
        {busy && <Loader2 aria-hidden="true" className="animate-spin" />}
        {t("passwordSave")}
      </Button>
      <p className="text-xs text-muted-foreground">{t("passwordPolicy")}</p>
    </form>
  );
}

/** Apple is a round trip, so linking is an anchor and unlinking is an action. */
function AppleRow({ linked }: { linked: boolean }) {
  const router = useRouter();
  const t = useTranslations("userSettings");
  const tApple = useTranslations("appleAccount");
  const [unlinking, setUnlinking] = useState(false);

  const unlink = async () => {
    const result = await unlinkAppleAction();
    if (!result.ok) {
      toast.error(result.error ?? tApple("unlinkFailed"));
      return;
    }
    toast.success(tApple("unlinkedToast"));
    setUnlinking(false);
    router.refresh();
  };

  return (
    <>
      <div className="flex items-start justify-between gap-3 border-t border-border px-4 py-3.5">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium">{t("appleTitle")}</p>
          <p className="text-xs text-muted-foreground">
            {linked ? t("appleLinked") : t("appleNotLinked")}
          </p>
        </div>
        {linked ? (
          <Pill onClick={() => setUnlinking(true)}>{t("appleUnlink")}</Pill>
        ) : (
          <Pill asLink href={APPLE_START_PATH}>
            {t("appleLink")}
          </Pill>
        )}
      </div>

      <ConfirmSheet
        open={unlinking}
        onOpenChange={setUnlinking}
        title={tApple("unlinkTitle")}
        body={tApple("unlinkBody")}
        confirmLabel={t("appleUnlink")}
        destructive
        onConfirm={unlink}
      />
    </>
  );
}

const PILL = cn(
  "tap-target inline-flex h-7 shrink-0 items-center rounded-full border border-input px-2.5",
  "text-xs font-medium transition-colors hover:bg-foreground/6",
  "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
);

function Pill({
  asLink,
  href,
  children,
  ...props
}: React.ComponentProps<"button"> & { asLink?: boolean; href?: string }) {
  if (asLink && href) {
    // An anchor, not a Link: `/forgot-password` is outside the settings
    // surface and the Apple start endpoint leaves the site altogether.
    return (
      <a href={href} className={PILL}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" className={PILL} {...props}>
      {children}
    </button>
  );
}
