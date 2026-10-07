"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { MoreHorizontal } from "lucide-react";
import { MemberAvatar } from "@/components/entries/pills";
import { Amount } from "@/components/money/amount";
import { TONE, toneFor } from "@/components/money/balance-tone";
import { PUSH } from "@/components/motion/transitions";
import { RemindButton } from "@/components/reminders/remind-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useNumberLocale } from "@/i18n/format-context";
import { formatMoney, money } from "@/modules/currencies/money";
import type { RemindRecipient } from "@/modules/reminders/types";
import { cn } from "@/lib/utils";
import { AddPersonRow } from "./add-person-row";
import type { PersonView } from "./people-card";
import type { PeopleLedger } from "./people-ledger";
import { openings, PersonPanel } from "./person-row";

/**
 * The People card as a table, from `lg` up: the phone's rows, drawn at width.
 *
 * Not a second list. The people are the ones the phone's card is handed, in
 * the same order, and everything a row can do is the phone's own: the menu at
 * the end of a row opens the very panel the phone opens under it — rename,
 * the personal link, remove, leave — so the two can never offer different
 * things. What the width buys is what the phone leaves to a person's own
 * page: their role, what they paid and what their share came to, where they
 * stand, and Remind for whoever owes the reader.
 *
 * It is the transactions table's recipe (`transactions-table.tsx`): a card
 * box, a 36px header on a muted wash, 52px rows, figures right-aligned and
 * tabular, and the row one link — here to the person's page, on their name,
 * its `::after` stretched over the row. The two buttons at the end sit above
 * that link, so pressing them never opens the page as well.
 *
 * ## Which columns, at which width
 *
 * Laid out automatically rather than to fixed widths: every column but the
 * person's shrinks to what it holds and never wraps, so a figure is never cut
 * short or pushed into its neighbour, and the person's column takes what is
 * left and is the one that truncates. Share goes first when the box is
 * narrow — under 48rem, which is the 1024px window beside an expanded
 * sidebar — because the person's page has it, and the position beside it is
 * the column the reader came for.
 *
 * ## The open row
 *
 * A row whose menu is open is washed one step darker than a hovered one,
 * rather than in the accent the design drew: the row carries a balance, and
 * the accent never colours a surface money sits on (see `AGENTS.md`).
 */

const HEAD =
  "h-9 px-3 text-left align-middle text-xs font-medium tracking-[0.04em] whitespace-nowrap text-muted-foreground uppercase";

/** A column as wide as what it holds, and no wider. */
const FIT = "w-px whitespace-nowrap";

/** Share, which gives way first. */
const WIDE = "hidden @min-[48rem]:table-cell";

export interface PeopleTableProps {
  groupId: string;
  groupName: string;
  archived: boolean;
  people: readonly PersonView[];
  viewerId: string | null;
  canManage: boolean;
  canInvite: boolean;
  canRemove: boolean;
  canLeave: boolean;
  /** Paid and Share, in one currency; null when the group has spent nothing. */
  ledger: PeopleLedger | null;
  /** Whoever owes the reader, as the Remind flow knows them. */
  recipients: readonly RemindRecipient[];
  /** The reader's name, which a reminder is signed with. */
  senderName: string;
  /** The row whose menu is open, owned by the card for both renderers. */
  openId: string | null;
  onOpenChange: (id: string | null) => void;
  reveal: { id: string; url: string } | null;
  onReveal: (id: string, url: string) => void;
  onDismissReveal: () => void;
  onAskRemove: (id: string) => void;
  adding: boolean;
  onAddOpen: () => void;
  onAddClose: () => void;
  onAdded: (participantId: string, url: string) => void;
}

export function PeopleTable({
  groupId,
  groupName,
  archived,
  people,
  viewerId,
  canManage,
  canInvite,
  canRemove,
  canLeave,
  ledger,
  recipients,
  senderName,
  openId,
  onOpenChange,
  reveal,
  onReveal,
  onDismissReveal,
  onAskRemove,
  adding,
  onAddOpen,
  onAddClose,
  onAdded,
}: PeopleTableProps) {
  const t = useTranslations("membersPage");
  const tt = useTranslations("membersPage.table");

  const rows = people.map((person) => {
    const isSelf = person.id === viewerId;
    const may = openings(person, {
      isSelf,
      manage: canManage,
      invite: canInvite,
      remove: canRemove,
      leave: canLeave,
    });
    return {
      person,
      isSelf,
      may,
      // The same test the phone's row makes before it offers to open.
      menu: may.name || may.email || may.access || may.remove || may.leave,
      reminder:
        recipients.find((recipient) => recipient.participantId === person.id) ??
        null,
    };
  });

  // A column with nothing in any row is not drawn at all.
  const actions = rows.some((row) => row.menu || row.reminder !== null);
  const unclaimed = people.filter(
    (person) => person.access !== "account",
  ).length;

  return (
    <div className="@container overflow-hidden rounded-2xl bg-card ring-1 ring-border">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{t("title")}</caption>
        <thead className="bg-muted/40">
          <tr className="border-b">
            <th scope="col" className={cn(HEAD, "w-full pl-4")}>
              {tt("person")}
            </th>
            <th scope="col" className={cn(HEAD, FIT)}>
              {tt("role")}
            </th>
            {ledger && (
              <th scope="col" className={cn(HEAD, FIT, "text-right")}>
                {tt("paid")}
              </th>
            )}
            {ledger && (
              <th scope="col" className={cn(HEAD, FIT, WIDE, "text-right")}>
                {tt("share")}
              </th>
            )}
            <th
              scope="col"
              className={cn(HEAD, FIT, "text-right", !actions && "pr-4")}
            >
              {tt("position")}
            </th>
            {actions && (
              <th scope="col" className={cn(HEAD, FIT, "pr-4")}>
                <span className="sr-only">{tt("actions")}</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ person, isSelf, may, menu, reminder }) => (
            <PersonTableRow
              key={person.id}
              groupId={groupId}
              groupName={groupName}
              archived={archived}
              person={person}
              isSelf={isSelf}
              may={may}
              menu={menu}
              reminder={reminder}
              actions={actions}
              ledger={ledger}
              senderName={senderName}
              isOpen={openId === person.id}
              onOpenChange={(next) => onOpenChange(next ? person.id : null)}
              revealUrl={reveal?.id === person.id ? reveal.url : null}
              onReveal={(url) => onReveal(person.id, url)}
              onDismissReveal={onDismissReveal}
              onAskRemove={() => onAskRemove(person.id)}
            />
          ))}
        </tbody>
      </table>

      {canManage && (
        // The phone card's last row, under the table: the same form, which
        // hands a freshly made link back to the new person's row menu.
        <div className="border-t">
          <AddPersonRow
            groupId={groupId}
            open={adding}
            onOpen={onAddOpen}
            onClose={onAddClose}
            onAdded={onAdded}
            canInvite={canInvite}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
        <p>{tt("footer", { people: people.length, unclaimed })}</p>
        {ledger && ledger.others.length > 0 && (
          <p className="text-right">
            {tt("footerCurrencies", {
              currency: ledger.currency,
              others: ledger.others.join(" · "),
            })}
          </p>
        )}
      </div>
    </div>
  );
}

function PersonTableRow({
  groupId,
  groupName,
  archived,
  person,
  isSelf,
  may,
  menu,
  reminder,
  actions,
  ledger,
  senderName,
  isOpen,
  onOpenChange,
  revealUrl,
  onReveal,
  onDismissReveal,
  onAskRemove,
}: {
  groupId: string;
  groupName: string;
  archived: boolean;
  person: PersonView;
  isSelf: boolean;
  may: ReturnType<typeof openings>;
  menu: boolean;
  reminder: RemindRecipient | null;
  /** Whether the table has an actions column at all. */
  actions: boolean;
  ledger: PeopleLedger | null;
  senderName: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  revealUrl: string | null;
  onReveal: (url: string) => void;
  onDismissReveal: () => void;
  onAskRemove: () => void;
}) {
  const t = useTranslations("membersPage");
  const tt = useTranslations("membersPage.table");
  const tStats = useTranslations("memberStats");
  const tSettle = useTranslations("settleUp");

  /*
   * Under the name, what the phone's row says under it — the address, or how
   * far somebody without an account has got with their link — except on the
   * reader's own row, which says "you": the role column beside it already
   * says what they are here, and their own address is not news to them.
   */
  const caption = isSelf
    ? tt("you")
    : person.access === "account"
      ? person.email
      : person.access === "link" && person.link
        ? person.link.lastUsedAt
          ? t("metaNoAccountJoined")
          : t("metaNoAccountInvited")
        : t("metaNoAccount");

  const figures = ledger?.figures[person.id] ?? { paid: "0", share: "0" };

  return (
    <tr
      className={cn(
        "relative border-b transition-colors last:border-b-0 hover:bg-wash-1 has-[a:focus-visible]:bg-wash-1 motion-reduce:transition-none",
        isOpen && "bg-wash-2 hover:bg-wash-2",
      )}
    >
      <td className="h-13 w-full max-w-0 py-2 pr-3 pl-4 align-middle">
        <span className="flex min-w-0 items-center gap-2.5">
          <MemberAvatar
            name={person.name}
            // The reader's own face in the accent, as the "you" pill is
            // everywhere else; a dashed ring for anybody with no account.
            selected={isSelf}
            guest={person.access !== "account"}
            className="size-8"
          />
          <span className="flex min-w-0 flex-col">
            <Link
              href={`/groups/${groupId}/members/${person.id}`}
              transitionTypes={PUSH}
              className="truncate font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
            >
              {person.name}
            </Link>
            {caption && (
              <span className="truncate text-xs text-muted-foreground">
                {caption}
              </span>
            )}
          </span>
        </span>
      </td>

      <td className="px-3 py-2 align-middle whitespace-nowrap">
        {/* The person's page names the same three in its badge. */}
        {person.isOwner ? (
          <Badge variant="secondary">{tStats("badgeOwner")}</Badge>
        ) : person.access === "account" ? (
          <span className="text-xs text-muted-foreground">
            {tStats("badgeMember")}
          </span>
        ) : (
          <Badge variant="outline">{tStats("badgeGuest")}</Badge>
        )}
      </td>

      {ledger && (
        <td className="px-3 py-2 text-right align-middle whitespace-nowrap tabular-nums">
          <Amount minorUnits={figures.paid} currency={ledger.currency} />
        </td>
      )}
      {ledger && (
        <td
          className={cn(
            WIDE,
            "px-3 py-2 text-right align-middle whitespace-nowrap tabular-nums",
          )}
        >
          <Amount minorUnits={figures.share} currency={ledger.currency} />
        </td>
      )}

      <td
        className={cn(
          "py-2 pl-3 text-right align-middle",
          actions ? "pr-3" : "pr-4",
        )}
      >
        <PositionCell person={person} isSelf={isSelf} />
      </td>

      {actions && (
        <td className="py-2 pr-4 pl-3 align-middle">
          {/* Above the row's link, which is stretched over everything else. */}
          <span className="relative z-10 flex items-center justify-end gap-1">
            {reminder && (
              <RemindButton
                groupId={groupId}
                groupName={groupName}
                senderName={senderName}
                recipients={[reminder]}
                ariaLabel={tSettle("remindPerson", { name: person.name })}
                // Drawn at 32px and hit at 44, as a button in a row is.
                className="lg:h-8 lg:rounded-lg lg:px-2.5"
              />
            )}
            {menu && (
              <Popover open={isOpen} onOpenChange={onOpenChange}>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={tt("options", { name: person.name })}
                    data-person-menu={person.id}
                    className="text-muted-foreground aria-expanded:bg-wash-2 aria-expanded:text-foreground"
                  >
                    <MoreHorizontal aria-hidden="true" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  aria-label={tt("options", { name: person.name })}
                  className="max-h-(--radix-popover-content-available-height) w-88 gap-0 overflow-y-auto rounded-2xl p-2"
                >
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
                    className="bg-transparent px-1.5 pt-2 pb-2 motion-safe:animate-none"
                  />
                </PopoverContent>
              </Popover>
            )}
          </span>
        </td>
      )}
    </tr>
  );
}

/**
 * Where somebody stands, one line per currency they are not square in.
 *
 * The figure and its word, both in the tone's ink, and the figure unsigned
 * because the word beside it says which way it goes. Each line is one whole
 * message with the figure as a tag inside it, so a language can put the verb
 * first. A person square in every currency is "Settled up", in the neutral
 * ink, never a zero.
 */
function PositionCell({
  person,
  isSelf,
}: {
  person: PersonView;
  isSelf: boolean;
}) {
  const tt = useTranslations("membersPage.table");
  const tMoney = useTranslations("money");
  const locale = useNumberLocale();

  if (person.balances.length === 0) {
    return (
      <span
        className={cn(
          "text-xs font-medium whitespace-nowrap",
          TONE.neutral.ink,
        )}
      >
        {tMoney("settledUpBadge")}
      </span>
    );
  }

  return (
    <span className="flex flex-col items-end gap-0.5">
      {person.balances.map((balance) => {
        const signed = BigInt(balance.minorUnits);
        const tone = toneFor(signed);
        const amount = formatMoney(
          money(signed < 0n ? -signed : signed, balance.currency),
          { locale },
        );
        const key =
          tone === "positive"
            ? isSelf
              ? "positionYouGetBack"
              : "positionGetsBack"
            : isSelf
              ? "positionYouOwe"
              : "positionOwes";
        return (
          <span
            key={balance.currency}
            className={cn(
              "text-xs font-medium whitespace-nowrap",
              TONE[tone].ink,
            )}
          >
            {tt.rich(key, {
              amount,
              figure: (chunks) => (
                <span className="text-sm font-semibold tabular-nums">
                  {chunks}
                </span>
              ),
            })}
          </span>
        );
      })}
    </span>
  );
}
