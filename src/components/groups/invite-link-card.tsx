"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Ban, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  CopyButton,
  ExpiryRow,
  LinkChip,
  ShareButton,
  useCanShare,
} from "@/components/groups/invite-link-controls";
import {
  createJoinLinkAction,
  revokeJoinLinkAction,
} from "@/modules/join/actions";
import { cn } from "@/lib/utils";

/**
 * The group's invite link, where the organiser comes back to it.
 *
 * It sits second in settings, under Details, because it is the one live
 * control on this screen: everything else here describes the group, this
 * decides who else can be in it. Revoking lives here too rather than in the
 * danger zone — a revoked link is replaced by a new one in a tap, which is
 * nothing like archiving or deleting, and putting it below Delete would make
 * turning the link off a scroll past the two irreversible things.
 *
 * Four states, and they are the same card: live and shareable; lapsed or
 * revoked, where the link is still shown, struck through, with one way
 * forward; and live but no longer readable, which is what a link minted before
 * the sealed copy existed looks like.
 */
export function InviteLinkCard({
  groupId,
  groupName,
  link,
  unclaimedCount,
  now,
}: {
  groupId: string;
  groupName: string;
  /** Null when the group has never had a link — only possible for old groups. */
  link: {
    status: "active" | "expired" | "revoked";
    /** Null when the sealed copy could not be opened. */
    url: string | null;
    expiresAt: string | null;
  } | null;
  /** People in the group with no account yet. Zero hides the cross-link. */
  unclaimedCount: number;
  /** When the server rendered this. See `ExpiryRow`. */
  now: string;
}) {
  const t = useTranslations("inviteLink");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const canShare = useCanShare();
  const [pending, setPending] = useState(false);

  const live = link?.status === "active";
  /** The live link, only when it can actually be handed to somebody. */
  const shareableUrl = live ? link.url : null;

  const onCreate = async () => {
    setPending(true);
    try {
      const result = await createJoinLinkAction(groupId, new FormData());
      if (!result.ok) {
        toast.error(result.error ?? t("createFailed"));
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  const onRevoke = async () => {
    setPending(true);
    try {
      const result = await revokeJoinLinkAction(groupId);
      if (!result.ok) {
        toast.error(result.error ?? t("revokeFailed"));
        return;
      }
      toast.success(t("revoked"));
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("heading")}</CardTitle>
        {/* The header's own two-column grid, which the badge opts into rather
            than the row re-inventing a flex layout on top of it. */}
        {link && (
          <CardAction className="self-center">
            <StatusBadge status={link.status} />
          </CardAction>
        )}
      </CardHeader>

      <CardContent className="flex flex-col gap-3.5">
        {link?.url ? (
          <LinkChip url={link.url} spent={!live} className="block" />
        ) : (
          <p className="text-sm text-pretty text-muted-foreground">
            {link ? t("unreadable") : t("none")}
          </p>
        )}

        {shareableUrl ? (
          <>
            <div className="flex gap-2">
              {canShare === false ? (
                <CopyButton
                  url={shareableUrl}
                  variant="default"
                  className="flex-1"
                />
              ) : (
                <>
                  <ShareButton
                    url={shareableUrl}
                    groupName={groupName}
                    className="flex-1"
                  />
                  <CopyButton url={shareableUrl} className="flex-1" />
                </>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <ExpiryRow
                groupId={groupId}
                label={t("expires")}
                expiresAt={link?.expiresAt ?? null}
                now={now}
                disabled={pending}
              />
              <p className="text-xs text-pretty text-muted-foreground">
                {link?.expiresAt ? t("expiresNote") : t("expiresNoteNever")}
              </p>
            </div>
          </>
        ) : (
          /*
           * One way forward, whether the link lapsed, was revoked, or simply
           * cannot be read back. Sharing and expiry are meaningless in all
           * three, so they are gone rather than disabled — a greyed Share
           * invites a tap that will never do anything.
           */
          <Button
            type="button"
            className="h-10 w-full"
            onClick={() => void onCreate()}
            disabled={pending}
          >
            {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
            {t("createNew")}
          </Button>
        )}

        {unclaimedCount > 0 && (
          <>
            <div className="h-px bg-border" />
            {/*
              The one line that says whether the link is still needed. It goes
              when everybody has an account, which is also when this card stops
              having anything to tell the organiser.
            */}
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-pretty text-muted-foreground">
                {t("unclaimed", { count: unclaimedCount })}
              </span>
              <Link
                href={`/groups/${groupId}/members`}
                className="shrink-0 text-sm font-medium text-primary hover:underline"
              >
                {t("peopleLink")}
              </Link>
            </div>
          </>
        )}

        {live && (
          <div className={cn("flex flex-col gap-1.5", !shareableUrl && "pt-1")}>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="destructive"
                  className="h-9 w-fit"
                  disabled={pending}
                >
                  <Ban aria-hidden="true" />
                  {t("revoke")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("revokeConfirmTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("revokeConfirmBody")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={pending}>
                    {tCommon("cancel")}
                  </AlertDialogCancel>
                  <Button
                    variant="destructive"
                    disabled={pending}
                    onClick={() => void onRevoke()}
                  >
                    {pending && (
                      <Loader2 aria-hidden="true" className="animate-spin" />
                    )}
                    {t("revoke")}
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <p className="text-xs text-pretty text-muted-foreground">
              {t("revokeNote")}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Live, lapsed or turned off — said in one word, in the right colour. */
function StatusBadge({ status }: { status: "active" | "expired" | "revoked" }) {
  const t = useTranslations("inviteLink");

  if (status === "active") {
    return (
      /*
        The tint pair the app already uses for a positive chip, rather than the
        design's darkened literal: that value only reads on cream, and this
        badge has to work on the dark theme too.
      */
      <Badge className="bg-positive/15 text-positive">
        {t("statusActive")}
      </Badge>
    );
  }
  if (status === "expired") {
    return (
      <Badge className="bg-muted text-muted-foreground">
        {t("statusExpired")}
      </Badge>
    );
  }
  return <Badge variant="destructive">{t("statusRevoked")}</Badge>;
}
