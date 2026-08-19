"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Copy, Link2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useDateFormatter } from "@/i18n/format-context";
import {
  createJoinLinkAction,
  revokeJoinLinkAction,
} from "@/modules/join/actions";

/**
 * The one link for the whole group.
 *
 * Deliberately a separate card from the per-person invite links inside
 * `PeopleCard`: the two answer different questions. That one is "let *Jonas*
 * in"; this one is "let whoever is in the chat in", and whoever opens it
 * decides for themselves which name they are.
 *
 * The URL is shown exactly once, when it is minted, because only its hash is
 * stored. Losing it means replacing it — which is also the recovery path when
 * the link reaches a chat it should not have, so the two are the same button.
 */
export function GroupLinkCard({
  groupId,
  link,
}: {
  groupId: string;
  /** The live link's metadata, or null when the group has none. */
  link: {
    prefix: string;
    createdAt: string;
    expiresAt: string | null;
    lastUsedAt: string | null;
  } | null;
}) {
  const t = useTranslations("joinGroup.link");
  const router = useRouter();
  const dates = useDateFormatter();

  const [pending, setPending] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const onCreate = async () => {
    setPending(true);
    try {
      const result = await createJoinLinkAction(groupId, new FormData());
      if (!result.ok || !result.data) {
        toast.error(result.error ?? t("create"));
        return;
      }
      setRevealed(result.data.url);
      setCopied(false);
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
        toast.error(result.error ?? t("revoke"));
        return;
      }
      setRevealed(null);
      router.refresh();
      toast.success(t("revoked"));
    } finally {
      setPending(false);
    }
  };

  const onCopy = async () => {
    if (!revealed) return;
    await navigator.clipboard.writeText(revealed);
    setCopied(true);
    toast.success(t("copied"));
  };

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-start gap-2.5">
        <Link2
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        />
        <div className="flex flex-col gap-1">
          <h2 className="font-medium">{t("heading")}</h2>
          <p className="text-sm text-pretty text-muted-foreground">
            {t("description")}
          </p>
        </div>
      </div>

      {link ? (
        <div className="flex flex-col gap-1 text-sm">
          <span className="font-medium">
            {t("active", { prefix: link.prefix })}
          </span>
          <span className="text-xs text-muted-foreground">
            {link.expiresAt
              ? t("expires", { date: dates.plain(link.expiresAt) })
              : t("neverExpires")}
            {" · "}
            {link.lastUsedAt
              ? t("lastUsed", { date: dates.plain(link.lastUsedAt) })
              : t("neverUsed")}
          </span>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      )}

      {/*
        Shown once, right after minting. A reload loses it, which is the same
        promise the per-participant links make and for the same reason.
      */}
      {revealed && (
        <div className="flex flex-col gap-2">
          <Input readOnly value={revealed} onFocus={(e) => e.target.select()} />
          <Button variant="outline" size="lg" onClick={onCopy}>
            {copied ? (
              <Check aria-hidden="true" />
            ) : (
              <Copy aria-hidden="true" />
            )}
            {copied ? t("copied") : t("copy")}
          </Button>
        </div>
      )}

      <p className="flex items-start gap-2 text-xs text-pretty text-muted-foreground">
        <TriangleAlert
          aria-hidden="true"
          className="mt-0.5 size-3.5 shrink-0"
        />
        {t("warning")}
      </p>

      <div className="flex flex-wrap gap-2">
        <Button size="lg" onClick={onCreate} disabled={pending}>
          {link ? t("replace") : t("create")}
        </Button>
        {link && (
          <Button
            variant="outline"
            size="lg"
            onClick={onRevoke}
            disabled={pending}
          >
            {t("revoke")}
          </Button>
        )}
      </div>
    </Card>
  );
}
