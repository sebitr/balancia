"use client";

import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useDateFormatter } from "@/i18n/format-context";
import { KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  fetchPasskeys,
  registerPasskey,
  removePasskey,
  type PasskeyRecord,
} from "@/modules/auth/passkey-client";
import { usePasskeySupport } from "./use-passkey-support";

/**
 * Passkey enrolment and management.
 *
 * TanStack Query rather than a Server Component because the list changes in
 * response to a browser-only WebAuthn ceremony: registering has to happen
 * client-side, and the list must refresh immediately afterwards without a
 * full navigation.
 */
export function PasskeyManager({
  relyingPartyId,
  enabled,
}: {
  relyingPartyId: string;
  enabled: boolean;
}) {
  const queryClient = useQueryClient();
  const t = useTranslations("passkeys");
  const tCommon = useTranslations("common");
  const dates = useDateFormatter();
  const [name, setName] = useState("");
  const [registering, setRegistering] = useState(false);
  const browserSupported = usePasskeySupport();

  const { data, isLoading, error } = useQuery({
    queryKey: ["passkeys"],
    queryFn: fetchPasskeys,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["passkeys"] });
  }, [queryClient]);

  const canRegister = enabled && browserSupported;

  const onRegister = async () => {
    setRegistering(true);
    try {
      await registerPasskey(name.trim() || undefined);
      toast.success(t("addedToast"));
      setName("");
      refresh();
    } catch (registerError) {
      const message =
        registerError instanceof Error &&
        registerError.name === "NotAllowedError"
          ? t("cancelled")
          : registerError instanceof Error
            ? registerError.message
            : t("registerFailed");
      toast.error(message);
    } finally {
      setRegistering(false);
    }
  };

  const onDelete = async (id: string) => {
    try {
      await removePasskey(id);
      toast.success(t("removedToast"));
      refresh();
    } catch (deleteError) {
      toast.error(
        deleteError instanceof Error ? deleteError.message : t("removeFailed"),
      );
    }
  };

  return (
    <div className="space-y-4">
      {!browserSupported && (
        <Alert>
          <AlertDescription>{t("unsupported")}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("addTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="passkey-name">
              {t("name")}{" "}
              <span className="font-normal text-muted-foreground">
                ({tCommon("optional")})
              </span>
            </Label>
            <Input
              id="passkey-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("namePlaceholder")}
              maxLength={80}
              disabled={!canRegister}
            />
            <p className="text-xs text-muted-foreground">
              {t.rich("registeredFor", {
                domain: () => <code>{relyingPartyId}</code>,
              })}
            </p>
          </div>
          <Button
            onClick={() => void onRegister()}
            disabled={!canRegister || registering}
          >
            {registering ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : (
              <Plus aria-hidden="true" />
            )}
            {t("register")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("yourPasskeys")}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              {tCommon("loading")}
            </p>
          ) : error ? (
            <Alert variant="destructive">
              <AlertDescription>{t("loadFailed")}</AlertDescription>
            </Alert>
          ) : !data || data.length === 0 ? (
            <EmptyState
              icon={KeyRound}
              title={t("emptyTitle")}
              description={t("emptyDescription")}
              className="border-0 py-6"
            />
          ) : (
            <ul className="divide-y">
              {data.map((passkey: PasskeyRecord) => (
                <li
                  key={passkey.id}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {passkey.name || t("unnamed")}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t("added", {
                        date: dates.at(passkey.createdAt),
                      })}
                      {passkey.lastUsedAt &&
                        ` · ${t("lastUsed", {
                          date: dates.at(passkey.lastUsedAt),
                        })}`}
                      {passkey.backedUp && ` · ${t("synced")}`}
                    </span>
                  </span>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("removeLabel", {
                          name: passkey.name || t("thisPasskey"),
                        })}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t("removeTitle")}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {t("removeBody")}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t("keep")}</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={(event) => {
                            event.preventDefault();
                            void onDelete(passkey.id);
                          }}
                        >
                          {t("remove")}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
