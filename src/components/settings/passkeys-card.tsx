"use client";

import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useDateFormatter } from "@/i18n/format-context";
import { KeyRound, Loader2, Plus, Shield, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConfirmSheet } from "./confirm-sheet";
import {
  fetchPasskeys,
  registerPasskey,
  removePasskey,
  type PasskeyRecord,
} from "@/modules/auth/passkey-client";
import { usePasskeySupport } from "@/components/auth/use-passkey-support";

/**
 * The devices that can sign this account in.
 *
 * TanStack Query rather than a Server Component because the list changes in
 * response to a browser-only WebAuthn ceremony: registering has to happen on
 * the client, and the list must refresh straight afterwards without a
 * navigation.
 *
 * Adding is one button and no name field. The old screen asked for a label
 * before it would let you enrol, which is a question about bookkeeping asked
 * before the thing being bookkept exists — so the passkey is named after the
 * device that made it, and the row underneath says when it was added and last
 * used, which is what actually identifies it a year later.
 *
 * Removing asks first. A passkey is not recoverable, and on an account whose
 * only other credential is a password on a different device, removing the
 * wrong one is how somebody locks themselves out.
 */
export function PasskeysCard({
  relyingPartyId,
  secureContext,
}: {
  relyingPartyId: string;
  /** False on an http origin that is not localhost: WebAuthn will not run. */
  secureContext: boolean;
}) {
  const queryClient = useQueryClient();
  const t = useTranslations("userSettings");
  const tPasskeys = useTranslations("passkeys");
  const tCommon = useTranslations("common");
  const dates = useDateFormatter();
  const browserSupported = usePasskeySupport();

  const [registering, setRegistering] = useState(false);
  const [removing, setRemoving] = useState<PasskeyRecord | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["passkeys"],
    queryFn: fetchPasskeys,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["passkeys"] });
  }, [queryClient]);

  const canRegister = secureContext && browserSupported;

  const onRegister = async () => {
    setRegistering(true);
    try {
      await registerPasskey();
      toast.success(tPasskeys("addedToast"));
      refresh();
    } catch (registerError) {
      // Cancelling the system sheet is not a failure worth a red toast.
      if (
        registerError instanceof Error &&
        registerError.name === "NotAllowedError"
      ) {
        return;
      }
      toast.error(
        (registerError instanceof Error ? registerError.message : "") ||
          tPasskeys("registerFailed"),
      );
    } finally {
      setRegistering(false);
    }
  };

  const onDelete = async (passkey: PasskeyRecord) => {
    try {
      await removePasskey(passkey.id);
      toast.success(tPasskeys("removedToast"));
      refresh();
    } catch (deleteError) {
      toast.error(
        (deleteError instanceof Error ? deleteError.message : "") ||
          tPasskeys("removeFailed"),
      );
    } finally {
      setRemoving(null);
    }
  };

  const count = data?.length ?? 0;

  return (
    <section className="shrink-0 overflow-hidden rounded-xl bg-card text-card-foreground ring-1 ring-foreground/10">
      <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
        <h2 className="font-heading text-base font-semibold">
          {tPasskeys("yourPasskeys")}
        </h2>
        {count > 0 && (
          <span className="inline-flex h-5.5 items-center rounded-full bg-positive/15 px-2 text-2xs font-semibold text-positive-ink">
            {t("deviceCount", { count })}
          </span>
        )}
      </div>

      {!browserSupported && (
        <div className="px-4 pb-3">
          <Alert>
            <AlertDescription>{tPasskeys("unsupported")}</AlertDescription>
          </Alert>
        </div>
      )}

      {isLoading ? (
        <p className="flex items-center gap-2 px-4 pb-4 text-xs text-muted-foreground">
          <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
          {tCommon("loading")}
        </p>
      ) : error ? (
        <div className="px-4 pb-3">
          <Alert variant="destructive">
            <AlertDescription>{tPasskeys("loadFailed")}</AlertDescription>
          </Alert>
        </div>
      ) : !data || data.length === 0 ? (
        <p className="flex items-start gap-2.5 px-4 pb-4 text-xs text-pretty text-muted-foreground">
          <KeyRound aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          {tPasskeys("emptyDescription")}
        </p>
      ) : (
        <ul>
          {data.map((passkey: PasskeyRecord) => (
            <li
              key={passkey.id}
              className="flex items-center gap-3 border-t border-border px-4 py-3"
            >
              <span
                aria-hidden="true"
                className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-foreground/8"
              >
                <Shield className="size-4" strokeWidth={1.9} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {passkey.name || tPasskeys("unnamed")}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {tPasskeys("added", { date: dates.at(passkey.createdAt) })}
                  {passkey.lastUsedAt &&
                    ` · ${tPasskeys("lastUsed", {
                      date: dates.at(passkey.lastUsedAt),
                    })}`}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setRemoving(passkey)}
                aria-label={tPasskeys("removeLabel", {
                  name: passkey.name || tPasskeys("thisPasskey"),
                })}
                className="tap-target flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/8 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <Trash2 aria-hidden="true" className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2 border-t border-border px-4 py-3.5">
        <Button
          onClick={() => void onRegister()}
          disabled={!canRegister || registering}
          className="h-10 w-full rounded-xl text-sm"
        >
          {registering ? (
            <Loader2 aria-hidden="true" className="animate-spin" />
          ) : (
            <Plus aria-hidden="true" />
          )}
          {t("addThisDevice")}
        </Button>
        <p className="text-xs text-muted-foreground">
          {tPasskeys.rich("registeredFor", {
            domain: () => <code>{relyingPartyId}</code>,
          })}
        </p>
      </div>

      <ConfirmSheet
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={tPasskeys("removeTitle")}
        body={tPasskeys("removeBody")}
        confirmLabel={tCommon("remove")}
        destructive
        onConfirm={() => removing && onDelete(removing)}
      />
    </section>
  );
}
