"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useDateFormatter } from "@/i18n/format-context";
import { Check, Copy, Link2, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  createInvitationAction,
  revokeInvitationAction,
} from "@/modules/groups/actions";

/**
 * Guest invitation link management.
 *
 * The link is shown exactly once, immediately after it is created, because the
 * server stores only a hash of it. The UI states plainly what the link means:
 * anyone holding it acts as this participant.
 */
export function InvitationControls({
  groupId,
  participantId,
  displayName,
  hasActiveInvitation,
  invitationPrefix,
  expiresAt,
  lastUsedAt,
}: {
  groupId: string;
  participantId: string;
  displayName: string;
  hasActiveInvitation: boolean;
  invitationPrefix: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
}) {
  const router = useRouter();
  const t = useTranslations("invitations");
  const dates = useDateFormatter();
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState("never");

  const onCreate = async () => {
    setPending(true);
    try {
      const formData = new FormData();
      formData.set("participantId", participantId);
      formData.set("expiresInDays", expiresInDays);
      const result = await createInvitationAction(groupId, formData);
      if (!result.ok || !result.data) {
        toast.error(result.error ?? t("createFailed"));
        return;
      }
      setCreatedUrl(result.data.url);
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  const onRevoke = async () => {
    setPending(true);
    try {
      const result = await revokeInvitationAction(groupId, participantId);
      if (!result.ok) {
        toast.error(result.error ?? t("revokeFailed"));
        return;
      }
      setCreatedUrl(null);
      toast.success(t("revoked"));
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  const onCopy = async () => {
    if (!createdUrl) return;
    try {
      await navigator.clipboard.writeText(createdUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("copyFailed"));
    }
  };

  return (
    <div className="space-y-3 rounded-lg border bg-muted/40 p-3">
      {createdUrl ? (
        <>
          <Alert>
            <ShieldAlert aria-hidden="true" />
            <AlertTitle>{t("copyNow")}</AlertTitle>
            <AlertDescription className="space-y-2">
              <span>
                {t.rich("copyWarning", {
                  name: () => <strong>{displayName}</strong>,
                })}
              </span>
            </AlertDescription>
          </Alert>
          <div className="flex gap-2">
            <Input
              readOnly
              value={createdUrl}
              aria-label={t("linkFor", { name: displayName })}
              className="font-mono text-xs"
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => void onCopy()}
              aria-label={t("copyLink")}
            >
              {copied ? (
                <Check aria-hidden="true" className="text-positive" />
              ) : (
                <Copy aria-hidden="true" />
              )}
            </Button>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setCreatedUrl(null)}
          >
            {t("copied")}
          </Button>
        </>
      ) : hasActiveInvitation ? (
        <div className="space-y-2">
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Link2 aria-hidden="true" className="size-4" />
            {t("active")}
            {invitationPrefix && (
              <span className="font-mono text-xs">({invitationPrefix}…)</span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {expiresAt
              ? t("expiresOn", {
                  date: dates.at(expiresAt),
                })
              : t("neverExpires")}{" "}
            {lastUsedAt
              ? t("lastUsed", {
                  date: dates.at(lastUsedAt),
                })
              : t("neverUsed")}{" "}
            {t("cannotShowAgain")}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void onCreate()}
              disabled={pending}
            >
              {pending && (
                <Loader2 aria-hidden="true" className="animate-spin" />
              )}
              {t("replace")}
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                >
                  {t("revoke")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t("revokeTitle", { name: displayName })}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("revokeBody")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("keep")}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(event) => {
                      event.preventDefault();
                      void onRevoke();
                    }}
                  >
                    {t("revokeConfirm")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {t("noAccount", { name: displayName })}
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor={`expiry-${participantId}`} className="text-xs">
                {t("expires")}
              </Label>
              <select
                id={`expiry-${participantId}`}
                value={expiresInDays}
                onChange={(event) => setExpiresInDays(event.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <option value="never">{t("never")}</option>
                {[7, 30, 90].map((days) => (
                  <option key={days} value={days}>
                    {t("inDays", { count: days })}
                  </option>
                ))}
              </select>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={() => void onCreate()}
              disabled={pending}
            >
              {pending && (
                <Loader2 aria-hidden="true" className="animate-spin" />
              )}
              <Link2 aria-hidden="true" />
              {t("create")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
