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
import { ChoicePill } from "@/components/entries/pills";
import { Row, RowCard } from "@/components/entries/row-card";
import { Button } from "@/components/ui/button";
import { toastUndoable } from "@/components/ui/sonner";
import { useAutosave } from "@/components/ui/use-autosave";
import { useDateFormatter, useNumberLocale } from "@/i18n/format-context";
import { formatMoney, money } from "@/modules/currencies/money";
import {
  createInvitationAction,
  revokeInvitationAction,
  updateParticipantAction,
} from "@/modules/groups/actions";
import { addParticipantSchema } from "@/modules/groups/schemas";
import { cn } from "@/lib/utils";
import { LeaveGroup, type Outstanding } from "./leave-group";
import type { PersonView } from "./people-card";

/**
 * One person, collapsed to a line and expanded to their settings.
 *
 * The collapsed line answers "who is this and can they get in"; everything you
 * might do about it is one tap below. The row itself is the control — a chevron
 * you have to hit is a smaller target than the row it sits on — so the panel is
 * a sibling of the button rather than a child of it, which keeps the toggle
 * free of nested interactive elements.
 *
 * How much of that panel exists depends on who is reading, and the row can
 * therefore collapse to nothing but a name. Three rules decide it, and they are
 * gathered in `openings` below so the answer is in one place rather than spread
 * across four `&&`s in the markup.
 */

/**
 * What this reader may actually do about this person.
 *
 * Once someone has an account, their name and email are theirs: only they can
 * change the display name they carry in this group, and their email moves in
 * their account settings, not here. Access and removal belong to the owner
 * alone — a member runs the money, not the door. A row with no account behind
 * it is just a label, and whoever manages participants owns all of it.
 *
 * The one door a member does hold is their own way out, so the reader's own
 * row ends with leaving. The owner's row ends with it too, held shut with the
 * reason, because "how do I leave this?" is a question an owner asks as well
 * and the answer is somewhere else. A guest's row has nothing: their way out
 * is the owner's to give (see `leaveGroup` in `authorization.ts`).
 *
 * Exported for the table the same people are drawn as from `lg` up, whose
 * row menu holds this same panel and so has to ask the same question.
 */
export function openings(
  person: PersonView,
  can: {
    isSelf: boolean;
    manage: boolean;
    invite: boolean;
    remove: boolean;
    leave: boolean;
  },
) {
  const hasAccount = person.access === "account";
  return {
    /** Their display name in this group. */
    name: hasAccount ? can.isSelf : can.manage,
    /** The email a person without an account can be reached at. */
    email: !hasAccount && can.manage,
    /** The whole access block — personal links, and who has one. */
    access: can.invite,
    /** Taking them out of the group. The owner never appears here. */
    remove: can.remove && !person.isOwner,
    /** Taking yourself out: a member can, and the owner is told why not. */
    leave: can.isSelf && (can.leave || person.isOwner),
  };
}

/** Expiries offered when issuing a link, as days. `null` never expires. */
const EXPIRIES: readonly {
  key: "never" | "week" | "day";
  days: number | null;
}[] = [
  { key: "never", days: null },
  { key: "week", days: 7 },
  { key: "day", days: 1 },
];

/** What a row writes back: the two fields the panel offers. */
interface Named {
  readonly name: string;
  readonly email: string;
}

/**
 * Whether an address is one yet.
 *
 * Asked of the schema the Server Action parses with rather than of a second
 * regex written here, so a field that holds the write back and a server that
 * refuses it can never disagree. An empty address is fine — it is optional.
 */
function emailReady(value: string): boolean {
  return addParticipantSchema.shape.email.safeParse(value.trim()).success;
}

/**
 * The caption over each card in the open row, outside it, as the settings
 * screens put theirs: it names the set of rows below rather than being the
 * first of them.
 */
const EYEBROW =
  "px-1.5 text-2xs font-semibold tracking-[0.08em] text-muted-foreground uppercase";

/**
 * A field inside a row of the card. Borderless, as the entry sheet's are: the
 * card is already its edge, and it rings whenever a field inside it has focus
 * (see `RowCard`). The value sits at the trailing edge, opposite its label,
 * the way a settings row puts its value opposite its name.
 */
const FIELD =
  "min-w-0 flex-1 bg-transparent text-right text-base outline-none placeholder:text-muted-foreground md:text-sm";

export function PersonRow({
  groupId,
  groupName,
  archived,
  person,
  isOpen,
  onToggle,
  revealUrl,
  onReveal,
  onDismissReveal,
  onAskRemove,
  isSelf,
  canManage,
  canInvite,
  canRemove,
  canLeave,
}: {
  groupId: string;
  groupName: string;
  archived: boolean;
  person: PersonView;
  isOpen: boolean;
  onToggle: () => void;
  revealUrl: string | null;
  onReveal: (url: string) => void;
  onDismissReveal: () => void;
  onAskRemove: () => void;
  isSelf: boolean;
  canManage: boolean;
  canInvite: boolean;
  canRemove: boolean;
  canLeave: boolean;
}) {
  const t = useTranslations("membersPage");
  const may = openings(person, {
    isSelf,
    manage: canManage,
    invite: canInvite,
    remove: canRemove,
    leave: canLeave,
  });
  // Nothing to open is nothing to tap: a row with an empty panel behind it
  // stays a plain line rather than a control that answers with a blank.
  const expandable =
    may.name || may.email || may.access || may.remove || may.leave;

  /*
   * What the pill does not already say.
   *
   * The pill carries who somebody is here — Guest, or No access. This line
   * carries what has happened to their way in, and the two used to give the
   * same answer twice: a guest was pilled "Invité" and captioned "Pas de
   * compte - Invité", which is one fact wearing two labels. It also arrived
   * punctuated two ways, an en dash here and a middle dot on the line under
   * it, so two adjacent rows appeared to follow different rules.
   *
   * One separator now, and each state says something the pill cannot: whether
   * the link has been used, or that no link was ever sent.
   */
  const meta =
    person.access === "account"
      ? person.email
      : person.access === "link" && person.link
        ? person.link.lastUsedAt
          ? t("metaNoAccountJoined")
          : t("metaNoAccountInvited")
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
          <span className="text-sm font-semibold tracking-[-0.01em]">
            {person.name}
          </span>
          {person.isOwner && <Pill tone="solid">{t("owner")}</Pill>}
          {person.access === "link" && (
            <Pill tone="primary">
              <Link2 aria-hidden="true" className="size-[11px]" />
              {t("guest")}
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
          groupName={groupName}
          archived={archived}
          person={person}
          revealUrl={revealUrl}
          onReveal={onReveal}
          onDismissReveal={onDismissReveal}
          onAskRemove={onAskRemove}
          may={may}
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
        "inline-flex h-[19px] items-center gap-1 rounded-full px-2 text-2xs font-semibold",
        tone === "solid" && "bg-secondary text-secondary-foreground",
        tone === "primary" &&
          "bg-[color-mix(in_oklch,var(--primary)_16%,transparent)] text-primary-ink",
        tone === "outline" &&
          "border border-border font-medium text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

/**
 * The open half of a row: rename, access, remove or leave — whichever of those
 * this reader is entitled to, per `may`.
 *
 * Mounted only while open, which is what resets the name and email drafts — a
 * half-typed rename is not something to carry back after closing the row and
 * coming back to it.
 *
 * The phone opens it under the row; from `lg` up the table opens the same
 * panel in the row's menu, so the two can never offer different things.
 * `className` is how the menu takes away the wash and the inset that only
 * make sense under a row.
 */
export function PersonPanel({
  groupId,
  groupName,
  archived,
  person,
  revealUrl,
  onReveal,
  onDismissReveal,
  onAskRemove,
  may,
  className,
}: {
  groupId: string;
  groupName: string;
  archived: boolean;
  person: PersonView;
  revealUrl: string | null;
  onReveal: (url: string) => void;
  onDismissReveal: () => void;
  onAskRemove: () => void;
  may: ReturnType<typeof openings>;
  className?: string;
}) {
  const router = useRouter();
  const t = useTranslations("membersPage");
  const tCommon = useTranslations("common");
  const dates = useDateFormatter();
  const locale = useNumberLocale();

  const [expiry, setExpiry] =
    useState<(typeof EXPIRIES)[number]["key"]>("never");
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  /*
   * Whether the reader has asked for a personal link yet. The offer is one
   * quiet button under one sentence, and how long the link lasts only appears
   * once it is pressed: the group link at the foot of the screen is the one
   * to send nearly every time, and a row that led with an expiry and a filled
   * "Create" button made this one look like the main thing to do.
   */
  const [offering, setOffering] = useState(false);

  const nameId = `person-name-${person.id}`;
  const emailId = `person-email-${person.id}`;
  const expiryId = `person-expiry-${person.id}`;
  const offerId = `person-offer-${person.id}`;

  const { draft, saving, edit, flush } = useAutosave<Named>({
    initial: { name: person.name, email: person.email },
    same: (a, b) => a.name === b.name && a.email === b.email,
    // Both halves have to be sendable before either is sent, since one write
    // carries the pair. An address is judged by the schema the server parses
    // with, so the field and the answer cannot disagree about what counts.
    ready: (next) =>
      next.name.trim() !== "" && (!may.email || emailReady(next.email)),
    write: async (next) => {
      const formData = new FormData();
      formData.set("displayName", next.name.trim());
      formData.set("email", next.email.trim());
      const result = await updateParticipantAction(
        groupId,
        person.id,
        formData,
      );
      if (!result.ok) {
        toast.error(result.error ?? t("saveFailed"));
        return false;
      }
      return true;
    },
    announce: (undo) =>
      toastUndoable(
        t("saved"),
        { label: tCommon("undo"), onUndo: undo },
        // Named for the person, so renaming a second one does not take away
        // the way back from the first.
        { id: `person-${person.id}` },
      ),
    settled: () => router.refresh(),
  });

  const nameMissing = draft.name.trim() === "";
  const emailWrong = may.email && !emailReady(draft.email);

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
      // Folded away again, so that revoking this link later comes back to
      // the quiet offer rather than to a half-made second one.
      setOffering(false);
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
      toast.success(t("revoked", { name: person.name }));
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

  /*
   * What this person is not square in, said once for both of the ways out of
   * the group that it blocks: being removed, and leaving.
   */
  const outstanding: Outstanding | null =
    person.balances.length === 0
      ? null
      : {
          amounts: person.balances
            .map((balance) => {
              const value = BigInt(balance.minorUnits);
              return formatMoney(
                money(value < 0n ? -value : value, balance.currency),
                { locale },
              );
            })
            .join(", "),
          direction: person.balances.every(
            (balance) => BigInt(balance.minorUnits) < 0n,
          )
            ? "owes"
            : person.balances.every(
                  (balance) => BigInt(balance.minorUnits) > 0n,
                )
              ? "owed"
              : "mixed",
        };

  return (
    <div
      className={cn(
        "flex flex-col gap-4 bg-[color-mix(in_oklch,var(--muted)_42%,transparent)] px-3.5 pt-0.5 pb-[18px] motion-safe:animate-in motion-safe:duration-150 motion-safe:fade-in-0 motion-safe:slide-in-from-top-1",
        className,
      )}
    >
      {/*
       * Two cards of rows, the way the entry sheet and the settings screens
       * group what belongs together: who this person is, then how they get
       * in. Each card is captioned from outside, and the way out of the group
       * stays last, under a hairline, as it always was.
       */}
      {may.name && (
        <div className="flex flex-col gap-2">
          <span className="flex items-center justify-between gap-2">
            <span className={EYEBROW}>{t("details")}</span>
            {/* For the eye only: the toast is what announces the outcome. */}
            {saving && (
              <span
                aria-hidden="true"
                className="flex items-center gap-1.5 px-1.5 text-xs text-muted-foreground"
              >
                <Loader2 className="size-3.5 animate-spin" />
                {t("saving")}
              </span>
            )}
          </span>
          <RowCard>
            <Row>
              <label htmlFor={nameId} className="shrink-0 text-sm font-medium">
                {may.email ? t("name") : t("nameHere")}
              </label>
              <input
                id={nameId}
                value={draft.name}
                maxLength={120}
                autoComplete="off"
                onChange={(event) => edit({ name: event.target.value })}
                onBlur={flush}
                aria-invalid={nameMissing}
                aria-describedby={nameMissing ? `${nameId}-error` : undefined}
                className={FIELD}
              />
            </Row>
            {may.email && (
              <Row>
                <label
                  htmlFor={emailId}
                  className="flex shrink-0 items-baseline gap-1.5 text-sm font-medium"
                >
                  {t("email")}
                  <span className="text-xs font-normal text-muted-foreground">
                    {tCommon("optional")}
                  </span>
                </label>
                <input
                  id={emailId}
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  value={draft.email}
                  placeholder="name@example.com"
                  onChange={(event) => edit({ email: event.target.value })}
                  onBlur={flush}
                  aria-invalid={emailWrong}
                  aria-describedby={emailWrong ? `${emailId}-error` : undefined}
                  className={FIELD}
                />
              </Row>
            )}
          </RowCard>
          {nameMissing && (
            <span
              id={`${nameId}-error`}
              className="px-1.5 text-xs text-destructive"
            >
              {t("nameRequired")}
            </span>
          )}
          {emailWrong && (
            <span
              id={`${emailId}-error`}
              className="px-1.5 text-xs text-destructive"
            >
              {t("emailInvalid")}
            </span>
          )}
        </div>
      )}

      {may.access && (
        <div className="flex flex-col gap-2">
          <span className={EYEBROW}>{t("access")}</span>

          {revealUrl ? (
            <div className="flex flex-col gap-2.5 rounded-[14px] border border-[color-mix(in_oklch,var(--primary)_30%,transparent)] bg-[color-mix(in_oklch,var(--primary)_8%,transparent)] p-3 motion-safe:animate-in motion-safe:duration-150 motion-safe:fade-in-0">
              <span className="flex items-start gap-2">
                <ShieldAlert
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-primary-ink"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="font-semibold">{t("copyNow")}</span>
                  <span className="text-xs text-pretty text-muted-foreground">
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
                className="h-8 self-start px-2.5 font-semibold text-primary-ink"
                onClick={onDismissReveal}
              >
                {t("copiedIt")}
              </Button>
            </div>
          ) : person.access === "account" ? (
            <RowCard>
              <p className="px-4 py-3.5 text-pretty text-muted-foreground">
                {/* Four phrasings rather than one assembled from fragments: an
                  owner reads a clause nobody else does, and naming the address
                  someone signs in with only works when there is one. */}
                {person.email
                  ? person.isOwner
                    ? t("accountOwnerEmail", {
                        name: person.name,
                        email: person.email,
                      })
                    : t("accountEmail", {
                        name: person.name,
                        email: person.email,
                      })
                  : person.isOwner
                    ? t("accountOwner", { name: person.name })
                    : t("account", { name: person.name })}
              </p>
            </RowCard>
          ) : person.access === "link" && person.link ? (
            <RowCard>
              <div className="flex items-center gap-3 px-4 py-3">
                <Link2
                  aria-hidden="true"
                  className="size-[18px] shrink-0 text-primary-ink"
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm font-medium text-pretty">
                    {t("linkIsLive", { name: person.name })}
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
              </div>
              <Row className="flex-wrap gap-2 py-2.5">
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
              </Row>
            </RowCard>
          ) : (
            <RowCard>
              <p className="px-4 py-3.5 text-pretty text-muted-foreground">
                {t("noAccessBlurb", { name: person.name })}
              </p>
              {/* Named for whom it is, so it can never be taken for the group
                  link: that one is everybody's, and this one acts as them. */}
              <button
                type="button"
                aria-expanded={offering}
                aria-controls={offerId}
                onClick={() => setOffering((open) => !open)}
                className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left text-sm font-semibold text-primary-ink transition-colors hover:bg-wash-1 focus-visible:bg-accent focus-visible:outline-none active:bg-accent"
              >
                <Link2 aria-hidden="true" className="size-[18px] shrink-0" />
                <span className="min-w-0 flex-1">
                  {t("personalLink", { name: person.name })}
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    "size-[18px] shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none",
                    offering && "rotate-180",
                  )}
                />
              </button>
              {offering && (
                <div
                  id={offerId}
                  className="flex flex-col gap-3 px-4 pt-3.5 pb-4 motion-safe:animate-in motion-safe:duration-150 motion-safe:fade-in-0"
                >
                  {/* The entry sheet's chips rather than a native select: three
                    choices fit on screen at once, and a picker hid two of
                    them behind a tap. */}
                  <div
                    role="group"
                    aria-labelledby={expiryId}
                    className="flex flex-col gap-2"
                  >
                    <span
                      id={expiryId}
                      className="text-xs font-medium text-muted-foreground"
                    >
                      {t("expires")}
                    </span>
                    <span className="flex flex-wrap gap-2">
                      {EXPIRIES.map((option) => (
                        <ChoicePill
                          key={option.key}
                          selected={expiry === option.key}
                          onClick={() => setExpiry(option.key)}
                        >
                          {t(`expiry_${option.key}`)}
                        </ChoicePill>
                      ))}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    className="h-10 font-semibold"
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
                </div>
              )}
            </RowCard>
          )}
        </div>
      )}

      {may.remove && (
        <div className="flex flex-col gap-1.5 border-t border-border pt-3.5">
          <Button
            variant="destructive"
            className="h-[38px] self-start px-3"
            onClick={onAskRemove}
            disabled={outstanding !== null}
          >
            <UserMinus aria-hidden="true" />
            {t("removeFromGroup")}
          </Button>
          <span className="text-xs text-pretty text-muted-foreground">
            {!outstanding
              ? t("removeHint")
              : outstanding.direction === "owes"
                ? t("removeBlockedOwes", {
                    name: person.name,
                    amounts: outstanding.amounts,
                  })
                : outstanding.direction === "owed"
                  ? t("removeBlockedOwed", {
                      name: person.name,
                      amounts: outstanding.amounts,
                    })
                  : t("removeBlockedMixed", {
                      name: person.name,
                      amounts: outstanding.amounts,
                    })}
          </span>
        </div>
      )}

      {may.leave && (
        <LeaveGroup
          groupId={groupId}
          groupName={groupName}
          isOwner={person.isOwner}
          archived={archived}
          outstanding={outstanding}
        />
      )}
    </div>
  );
}
