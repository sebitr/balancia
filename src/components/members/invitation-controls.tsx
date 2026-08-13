"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
        toast.error(result.error ?? "The link could not be created.");
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
        toast.error(result.error ?? "The link could not be revoked.");
        return;
      }
      setCreatedUrl(null);
      toast.success("Link revoked");
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
      toast.error("Could not copy — select the link and copy it manually.");
    }
  };

  return (
    <div className="space-y-3 rounded-lg border bg-muted/40 p-3">
      {createdUrl ? (
        <>
          <Alert>
            <ShieldAlert aria-hidden="true" />
            <AlertTitle>Copy this link now</AlertTitle>
            <AlertDescription className="space-y-2">
              <span>
                It is shown only once — Balancia stores only a hashed copy.
                Anyone who has this link can act as{" "}
                <strong>{displayName}</strong>: view the group, add and edit
                expenses, and record payments. Share it only with them, over a
                channel you trust.
              </span>
            </AlertDescription>
          </Alert>
          <div className="flex gap-2">
            <Input
              readOnly
              value={createdUrl}
              aria-label={`Invitation link for ${displayName}`}
              className="font-mono text-xs"
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => void onCopy()}
              aria-label="Copy invitation link"
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
            I have copied it
          </Button>
        </>
      ) : hasActiveInvitation ? (
        <div className="space-y-2">
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Link2 aria-hidden="true" className="size-4" />
            An invitation link is active
            {invitationPrefix && (
              <span className="font-mono text-xs">({invitationPrefix}…)</span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {expiresAt
              ? `Expires ${new Date(expiresAt).toLocaleDateString()}.`
              : "Does not expire."}{" "}
            {lastUsedAt
              ? `Last used ${new Date(lastUsedAt).toLocaleDateString()}.`
              : "Not used yet."}{" "}
            The link itself cannot be shown again.
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
              Replace with a new link
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                >
                  Revoke
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Revoke {displayName}&apos;s link?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    The link stops working immediately and anyone currently
                    signed in through it is signed out. Expenses they already
                    recorded stay in the group.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep it</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(event) => {
                      event.preventDefault();
                      void onRevoke();
                    }}
                  >
                    Revoke link
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {displayName} has no account. Create a link so they can take part
            without signing up.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor={`expiry-${participantId}`} className="text-xs">
                Expires
              </Label>
              <select
                id={`expiry-${participantId}`}
                value={expiresInDays}
                onChange={(event) => setExpiresInDays(event.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <option value="never">Never</option>
                <option value="7">In 7 days</option>
                <option value="30">In 30 days</option>
                <option value="90">In 90 days</option>
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
              Create invitation link
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
