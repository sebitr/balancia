"use client";

import { useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Check,
  ChevronDown,
  Copy,
  Link2,
  Loader2,
  RefreshCw,
  ShieldAlert,
  UserMinus,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDateFormatter, useNumberLocale } from "@/i18n/format-context";
import { formatMoney, money } from "@/modules/currencies/money";
import {
  createInvitationAction,
  revokeInvitationAction,
  updateParticipantAction,
} from "@/modules/groups/actions";
import { cn } from "@/lib/utils";
import type { PersonView } from "./people-card";

/**
 * One person, collapsed to a line and expanded to their settings.
 *
 * The collapsed line answers "who is this and can they get in"; everything you
 * might do about it is one tap below. The row itself is the control — a chevron
 * you have to hit is a smaller target than the row it sits on — so the panel is
 * a sibling of the button rather than a child of it, which keeps the toggle
 * free of nested interactive elements.
 */

/** Expiries offered when issuing a link, as days. `null` never expires. */
const EXPIRIES: readonly {
  key: "never" | "week" | "day";
  days: number | null;
}[] = [
  { key: "never", days: null },
  { key: "week", days: 7 },
  { key: "day", days: 1 },
];

const EYEBROW =
  "text-[0.6875rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase";
const FIELD =
  "h-[42px] rounded-lg border-input bg-[color-mix(in_oklch,var(--input)_30%,transparent)] px-3 text-sm";

export function PersonRow({
  groupId,
  person,
  isOpen,
  onToggle,
  revealUrl,
  onReveal,
  onDismissReveal,
  onAskRemove,
  canManage,
  canInvite,
}: {
  groupId: string;
  person: PersonView;
  isOpen: boolean;
  onToggle: () => void;
  revealUrl: string | null;
  onReveal: (url: string) => void;
  onDismissReveal: () => void;
  onAskRemove: () => void;
  canManage: boolean;
  canInvite: boolean;
}) {
  const t = useTranslations("membersPage");
  const dates = useDateFormatter();
  const expandable = canManage || canInvite;

  const meta =
    person.access === "account"
      ? [person.email, t("metaJoined", { date: dates.at(person.joinedAt) })]
          .filter(Boolean)
          .join(" · ")
      : person.access === "link" && person.link
        ? [
            t("metaLinkCreated", { date: dates.at(person.link.createdAt) }),
            person.link.lastUsedAt
              ? t("metaOpened", { date: dates.at(person.link.lastUsedAt) })
              : t("metaNotOpened"),
          ].join(" · ")
        : t("metaNoAccount");

  const summary = (
    <>
      <span
        aria-hidden="true"
        className="inline-flex size-[38px] shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground"
      >
        {[...person.name][0]?.toUpperCase() ?? "?"}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-[0.9375rem] font-semibold tracking-[-0.01em]">
            {person.name}
          </span>
          {person.isOwner && <Pill tone="solid">{t("owner")}</Pill>}
          {person.access === "link" && (
            <Pill tone="primary">
              <Link2 aria-hidden="true" className="size-[11px]" />
              {t("linkLive")}
            </Pill>
          )}
          {person.access === "none" && (
            <Pill tone="outline">{t("noAccess")}</Pill>
          )}
        </span>
        <span className="truncate text-xs text-muted-foreground">{meta}</span>
      </span>
    </>
  );

  return (
    <div className="border-b border-border last:border-b-0">
      {expandable ? (
        <div
          role="button"
          tabIndex={0}
          aria-expanded={isOpen}
          onClick={onToggle}
          onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            onToggle();
          }}
          className="flex min-h-[66px] cursor-pointer items-center gap-3 px-3.5 py-3.5 transition-colors hover:bg-[color-mix(in_oklch,var(--muted)_45%,transparent)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:-outline-offset-2 focus-visible:outline-none"
        >
          {summary}
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "size-[17px] shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none",
              isOpen && "rotate-180",
            )}
          />
        </div>
      ) : (
        <div className="flex min-h-[66px] items-center gap-3 px-3.5 py-3.5">
          {summary}
        </div>
      )}

      {isOpen && (
        <PersonPanel
          groupId={groupId}
          person={person}
          revealUrl={revealUrl}
          onReveal={onReveal}
          onDismissReveal={onDismissReveal}
          onAskRemove={onAskRemove}
          canManage={canManage}
          canInvite={canInvite}
        />
      )}
    </div>
  );
}

function Pill({
  tone,
  children,
}: {
  tone: "solid" | "primary" | "outline";
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[19px] items-center gap-1 rounded-full px-2 text-[0.6875rem] font-semibold",
        tone === "solid" && "bg-secondary text-secondary-foreground",
        tone === "primary" &&
          "bg-[color-mix(in_oklch,var(--primary)_16%,transparent)] text-primary",
        tone === "outline" &&
          "border border-border font-medium text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

/**
 * The open half of a row: rename, access, remove.
 *
 * Mounted only while open, which is what resets the name and email drafts — a
 * half-typed rename is not something to carry back after closing the row and
 * coming back to it.
 */
function PersonPanel({
  groupId,
  person,
  revealUrl,
  onReveal,
  onDismissReveal,
  onAskRemove,
  canManage,
  canInvite,
}: {
  groupId: string;
  person: PersonView;
  revealUrl: string | null;
  onReveal: (url: string) => void;
  onDismissReveal: () => void;
  onAskRemove: () => void;
  canManage: boolean;
  canInvite: boolean;
}) {
  const router = useRouter();
  const t = useTranslations("membersPage");
  const tCommon = useTranslations("common");
  const dates = useDateFormatter();
  const locale = useNumberLocale();

  const [name, setName] = useState(person.name);
  const [email, setEmail] = useState(person.email);
  const [expiry, setExpiry] =
    useState<(typeof EXPIRIES)[number]["key"]>("never");
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);

  const dirty = name.trim() !== person.name || email.trim() !== person.email;
  const nameId = `person-name-${person.id}`;
  const emailId = `person-email-${person.id}`;
  const expiryId = `person-expiry-${person.id}`;

  const onSave = async () => {
    setPending(true);
    try {
      const formData = new FormData();
      formData.set("displayName", name.trim());
      formData.set("email", email.trim());
      const result = await updateParticipantAction(
        groupId,
        person.id,
        formData,
      );
      if (!result.ok) {
        toast.error(result.error ?? t("saveFailed"));
        return;
      }
      router.refresh();
      toast.success(t("saved"));
    } finally {
      setPending(false);
    }
  };

  const onCreateLink = async () => {
    setPending(true);
    try {
      const days = EXPIRIES.find((option) => option.key === expiry)?.days;
      const formData = new FormData();
      formData.set("participantId", person.id);
      formData.set("expiresInDays", days === null ? "never" : String(days));
      const result = await createInvitationAction(groupId, formData);
      if (!result.ok || !result.data) {
        toast.error(result.error ?? t("createLinkFailed"));
        return;
      }
      onReveal(result.data.url);
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  const onRevoke = async () => {
    setPending(true);
    try {
      const result = await revokeInvitationAction(groupId, person.id);
      if (!result.ok) {
        toast.error(result.error ?? t("revokeFailed"));
        return;
      }
      onDismissReveal();
      router.refresh();
      toast.success(t("revoked"));
    } finally {
      setPending(false);
    }
  };

  const onCopy = async () => {
    if (!revealUrl) return;
    try {
      await navigator.clipboard.writeText(revealUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success(t("linkCopied"));
    } catch {
      toast.error(t("copyFailed"));
    }
  };

  const amounts = person.balances
    .map((balance) => {
      const value = BigInt(balance.minorUnits);
      return formatMoney(money(value < 0n ? -value : value, balance.currency), {
        locale,
      });
    })
    .join(", ");
  const blocked = person.balances.length > 0;
  const owesAll = person.balances.every(
    (balance) => BigInt(balance.minorUnits) < 0n,
  );
  const owedAll = person.balances.every(
    (balance) => BigInt(balance.minorUnits) > 0n,
  );

  return (
    <div className="flex flex-col gap-4 bg-[color-mix(in_oklch,var(--muted)_42%,transparent)] px-3.5 pt-0.5 pb-[18px] motion-safe:animate-in motion-safe:duration-150 motion-safe:fade-in-0 motion-safe:slide-in-from-top-1">
      {canManage && (
        <div className="flex flex-col gap-2.5">
          <span className={EYEBROW}>{t("details")}</span>
          <label htmlFor={nameId} className="flex flex-col gap-1.5">
            <span className="text-[0.8125rem] font-medium">{t("name")}</span>
            <Input
              id={nameId}
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              className={FIELD}
            />
          </label>
          <label htmlFor={emailId} className="flex flex-col gap-1.5">
            <span className="flex items-baseline gap-1.5 text-[0.8125rem] font-medium">
              {t("email")}
              <span className="text-xs font-normal text-muted-foreground">
                {tCommon("optional")}
              </span>
            </span>
            <Input
              id={emailId}
              type="email"
              inputMode="email"
              value={email}
              placeholder="name@example.com"
              onChange={(event) => setEmail(event.target.value)}
              className={FIELD}
            />
          </label>
          {dirty && (
            <span className="flex gap-2 pt-0.5">
              <Button
                className="h-[38px] px-3.5 font-semibold"
                onClick={() => void onSave()}
                disabled={pending || name.trim() === ""}
              >
                {pending && (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                )}
                {t("saveChanges")}
              </Button>
              <Button
                variant="ghost"
                className="h-[38px] px-3 text-muted-foreground"
                onClick={() => {
                  setName(person.name);
                  setEmail(person.email);
                }}
                disabled={pending}
              >
                {t("discard")}
              </Button>
            </span>
          )}
        </div>
      )}

      <div
        className={cn(
          "flex flex-col gap-2.5",
          canManage && "border-t border-border pt-3.5",
        )}
      >
        <span className={EYEBROW}>{t("access")}</span>

        {revealUrl ? (
          <div className="flex flex-col gap-2.5 rounded-[14px] border border-[color-mix(in_oklch,var(--primary)_30%,transparent)] bg-[color-mix(in_oklch,var(--primary)_8%,transparent)] p-3 motion-safe:animate-in motion-safe:duration-150 motion-safe:fade-in-0">
            <span className="flex items-start gap-2">
              <ShieldAlert
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-primary"
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-semibold">{t("copyNow")}</span>
                <span className="text-[0.8125rem] text-pretty text-muted-foreground">
                  {t("copyWarning", { name: person.name })}
                </span>
              </span>
            </span>
            <span className="flex items-center gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto rounded-[10px] bg-[color-mix(in_oklch,var(--foreground)_9%,transparent)] p-2.5 font-mono text-xs whitespace-nowrap">
                {revealUrl}
              </code>
              <Button
                size="icon"
                aria-label={t("copyLink")}
                className="size-[42px] shrink-0"
                onClick={() => void onCopy()}
              >
                {copied ? (
                  <Check aria-hidden="true" />
                ) : (
                  <Copy aria-hidden="true" />
                )}
              </Button>
            </span>
            <Button
              variant="ghost"
              className="h-8 self-start px-2.5 font-semibold text-primary"
              onClick={onDismissReveal}
            >
              {t("copiedIt")}
            </Button>
          </div>
        ) : person.access === "account" ? (
          <p className="text-pretty text-muted-foreground">
            {/* Four phrasings rather than one assembled from fragments: an
                owner reads a clause nobody else does, and naming the address
                someone signs in with only works when there is one. */}
            {person.email
              ? person.isOwner
                ? t("accountOwnerEmail", {
                    name: person.name,
                    email: person.email,
                  })
                : t("accountEmail", { name: person.name, email: person.email })
              : person.isOwner
                ? t("accountOwner", { name: person.name })
                : t("account", { name: person.name })}
          </p>
        ) : person.access === "link" && person.link ? (
          <div className="flex flex-col gap-2.5">
            <span className="flex items-center gap-2 rounded-lg border border-border bg-[color-mix(in_oklch,var(--card)_70%,transparent)] px-3 py-2.5">
              <Link2
                aria-hidden="true"
                className="size-4 shrink-0 text-primary"
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[0.8125rem] font-medium">
                  {t("linkIsLive")}
                </span>
                <span className="text-xs text-muted-foreground">
                  {[
                    t("linkCreated", {
                      date: dates.at(person.link.createdAt),
                    }),
                    person.link.expiresAt
                      ? t("linkExpires", {
                          date: dates.at(person.link.expiresAt),
                        })
                      : t("linkNeverExpires"),
                  ].join(" · ")}
                </span>
              </span>
            </span>
            {canInvite && (
              <span className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className="h-[38px] px-3"
                  onClick={() => void onCreateLink()}
                  disabled={pending}
                >
                  {pending ? (
                    <Loader2 aria-hidden="true" className="animate-spin" />
                  ) : (
                    <RefreshCw aria-hidden="true" />
                  )}
                  {t("replaceLink")}
                </Button>
                <Button
                  variant="destructive"
                  className="h-[38px] px-3"
                  onClick={() => void onRevoke()}
                  disabled={pending}
                >
                  {t("revoke")}
                </Button>
              </span>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            <p className="text-pretty text-muted-foreground">
              {t("noAccessBlurb", { name: person.name })}
            </p>
            {canInvite && (
              <span className="flex flex-wrap items-end gap-2">
                <label htmlFor={expiryId} className="flex flex-col gap-1.5">
                  <span className="text-[0.8125rem] font-medium">
                    {t("expires")}
                  </span>
                  {/* Native, like every other select in the app: a phone's own
                      picker beats a listbox that has to be scrolled. */}
                  <select
                    id={expiryId}
                    value={expiry}
                    onChange={(event) =>
                      setExpiry(
                        event.target.value as (typeof EXPIRIES)[number]["key"],
                      )
                    }
                    className={cn(
                      FIELD,
                      "min-w-[118px] border pr-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                    )}
                  >
                    {EXPIRIES.map((option) => (
                      <option key={option.key} value={option.key}>
                        {t(`expiry_${option.key}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  className="h-[42px] px-3.5 font-semibold"
                  onClick={() => void onCreateLink()}
                  disabled={pending}
                >
                  {pending ? (
                    <Loader2 aria-hidden="true" className="animate-spin" />
                  ) : (
                    <Link2 aria-hidden="true" />
                  )}
                  {t("createLink")}
                </Button>
              </span>
            )}
          </div>
        )}
      </div>

      {canManage && !person.isOwner && (
        <div className="flex flex-col gap-1.5 border-t border-border pt-3.5">
          <Button
            variant="destructive"
            className="h-[38px] self-start px-3"
            onClick={onAskRemove}
            disabled={blocked}
          >
            <UserMinus aria-hidden="true" />
            {t("removeFromGroup")}
          </Button>
          <span className="text-xs text-pretty text-muted-foreground">
            {!blocked
              ? t("removeHint")
              : owesAll
                ? t("removeBlockedOwes", { name: person.name, amounts })
                : owedAll
                  ? t("removeBlockedOwed", { name: person.name, amounts })
                  : t("removeBlockedMixed", { name: person.name, amounts })}
          </span>
        </div>
      )}
    </div>
  );
}
