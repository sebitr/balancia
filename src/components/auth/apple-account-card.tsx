"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { unlinkAppleAction } from "@/modules/auth/actions";
import { APPLE_START_PATH } from "@/modules/auth/apple-paths";

/**
 * The Apple account linked to this one, if there is one.
 *
 * Linking is an anchor rather than a button because it leaves the site: the
 * start endpoint mints the state cookie and hands the browser to Apple, which
 * eventually posts back to the callback and returns here. Unlinking is an
 * ordinary Server Action, and the service refuses it when Apple is the only
 * credential the account has left.
 */
export interface LinkedApple {
  readonly email: string | null;
  readonly isPrivateEmail: boolean;
  readonly linkedAt: string;
}

export function AppleAccountCard({ linked }: { linked: LinkedApple | null }) {
  const t = useTranslations("appleAccount");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const onUnlink = async () => {
    setPending(true);
    try {
      const result = await unlinkAppleAction();
      if (!result.ok) {
        toast.error(result.error ?? t("unlinkFailed"));
        return;
      }
      toast.success(t("unlinkedToast"));
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {linked ? (
          <>
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {linked.email ?? t("addressHidden")}
              </p>
              <p className="text-xs text-muted-foreground">
                {linked.isPrivateEmail
                  ? t("relayNote")
                  : t("linkedOn", {
                      date: format.dateTime(new Date(linked.linkedAt), {
                        dateStyle: "medium",
                      }),
                    })}
              </p>
            </div>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={pending}>
                  {pending && (
                    <Loader2 aria-hidden="true" className="animate-spin" />
                  )}
                  {t("unlink")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("unlinkTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("unlinkBody")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void onUnlink()}>
                    {t("unlink")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{t("intro")}</p>
            <Button asChild variant="outline" size="sm">
              <a href={APPLE_START_PATH}>{t("link")}</a>
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
