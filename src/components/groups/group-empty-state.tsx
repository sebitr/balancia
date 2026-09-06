import Link from "next/link";
import {
  ChevronRight,
  Download,
  Link2,
  Plus,
  ReceiptText,
  UserPlus,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { GuestLinkRow } from "@/components/groups/guest-link-row";
import { RemainingLabel } from "@/components/groups/invite-link-controls";
import { initialsOf } from "@/components/join/types";
import { PUSH } from "@/components/motion/transitions";
import { cn } from "@/lib/utils";

/** Somebody who shares this group's costs, as this screen needs them. */
export interface StartHerePerson {
  readonly participantId: string;
  readonly name: string;
  readonly isSelf: boolean;
}

/** How many faces the stack shows before it stops being faces. */
const FACES = 3;

/**
 * The useful first steps for a group that has not recorded money yet.
 *
 * Two things sit here, and the second one is why this file is not three
 * paragraphs of encouragement. The empty state says the one thing there is to
 * say — add an expense — and gets out of the way. Under it, "Start here"
 * *performs* the two steps a new group actually needs rather than describing
 * them: it shows who is in the group, and it hands over the guest link.
 *
 * That card used to be a paragraph telling the reader to open the People tab
 * and create a link. Both halves were wrong: the group already has a link, it
 * was minted with the group, and a screen that gives directions to a thing it
 * is holding is a screen that has decided not to help.
 */
export function GroupEmptyState({
  groupId,
  groupName,
  canImport,
  people,
  invite,
  now,
}: {
  groupId: string;
  groupName: string;
  canImport: boolean;
  /** Everyone sharing this group's costs, the reader first. */
  people: readonly StartHerePerson[];
  /**
   * The group's guest link, or null where there is none and where the reader
   * is not one of the people allowed to see it.
   */
  invite: { url: string; expiresAt: string | null } | null;
  /**
   * When the server drew this, so the link's remaining life is a subtraction
   * against one clock rather than two. See `ExpiryRow`.
   */
  now: string;
}) {
  const t = useTranslations("group");
  // The link row's own words belong to the link, not to this screen: it is
  // the same object settings and the People tab show, and it is named once.
  const tInvite = useTranslations("inviteLink");

  // Alone is not a smaller version of the same card: there is nobody to send
  // a link to yet, so offering one is offering a step that cannot be taken.
  // The ask is for names, and the link follows on its own.
  const alone = people.length <= 1;

  return (
    <div className="flex flex-col gap-[26px]">
      <section className="flex flex-col items-center rounded-[22px] border border-dashed border-border px-5 pt-7 pb-[22px] text-center">
        <span className="flex size-[46px] items-center justify-center rounded-full bg-accent text-primary-ink">
          <ReceiptText aria-hidden="true" className="size-5" />
        </span>
        <h1 className="mt-3.5 text-lg font-semibold tracking-[-0.015em]">
          {t("noExpensesTitle")}
        </h1>
        <p className="mt-1.5 max-w-[16rem] text-sm leading-[1.45] text-pretty text-muted-foreground">
          {t("emptyOverviewDescription")}
        </p>

        <Button
          asChild
          size="lg"
          className="mt-[18px] h-[46px] w-full max-w-[18rem] rounded-[13px] font-semibold"
        >
          <Link href={`/groups/${groupId}/expenses/new`}>
            <Plus aria-hidden="true" className="size-4" />
            {t("addExpense")}
          </Link>
        </Button>
        {/*
          A link rather than a second full-width button. Importing is the
          exception — most groups start empty on purpose — and drawing it at
          the same weight as "Add expense" made the screen ask a question
          instead of naming an action.
        */}
        {canImport && (
          <Button
            asChild
            variant="ghost"
            className="h-11 px-3 text-sm font-medium text-muted-foreground"
          >
            <Link href={`/groups/${groupId}/import`} transitionTypes={PUSH}>
              <Download aria-hidden="true" className="size-[15px]" />
              {t("importFromSplitwise")}
            </Link>
          </Button>
        )}
      </section>

      <section aria-labelledby="start-here" className="flex flex-col">
        <h2
          id="start-here"
          className="mb-2.5 text-2xs font-semibold tracking-[0.06em] text-muted-foreground uppercase"
        >
          {t("startHere")}
        </h2>

        {alone ? (
          <div className="flex flex-col gap-3 rounded-[18px] bg-card p-4 shadow-hairline">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-primary-ink">
                <Users aria-hidden="true" className="size-[18px]" />
              </span>
              <span className="flex min-w-0 flex-col gap-[3px]">
                <span className="text-sm font-semibold">{t("aloneTitle")}</span>
                <span className="text-xs leading-[1.4] text-pretty text-muted-foreground">
                  {t("aloneBody")}
                </span>
              </span>
            </div>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="h-[46px] rounded-[13px] border-primary/45 font-semibold text-primary-ink hover:text-primary-ink"
            >
              <Link href={`/groups/${groupId}/members`} transitionTypes={PUSH}>
                <UserPlus aria-hidden="true" className="size-4" />
                {t("addPeople")}
              </Link>
            </Button>
            <p className="text-2xs text-muted-foreground">
              {t("inviteLinkNext")}
            </p>
          </div>
        ) : (
          /* No border: the rows divide themselves, and a card outline around
             a divider is two lines saying one thing. */
          <div className="overflow-hidden rounded-[18px] bg-card shadow-hairline">
            <Link
              href={`/groups/${groupId}/members`}
              transitionTypes={PUSH}
              className="flex min-h-11 items-center gap-3 px-4 py-3.5"
            >
              {/* The names are spelled out on the line below, so the faces are
                  decoration and announcing their letters would be noise. */}
              <span aria-hidden="true" className="flex shrink-0">
                {people.slice(0, FACES).map((person, index) => (
                  <Avatar
                    key={person.participantId}
                    className={cn(
                      "size-[30px] ring-2 ring-card",
                      index > 0 && "-ml-[9px]",
                    )}
                  >
                    <AvatarFallback className="bg-accent text-2xs font-semibold text-accent-foreground">
                      {initialsOf(person.name)}
                    </AvatarFallback>
                  </Avatar>
                ))}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-semibold">
                  {t("peopleCount", { count: people.length })}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {people
                    .map((person) => (person.isSelf ? t("you") : person.name))
                    .join(", ")}
                </span>
              </span>
              <ChevronRight
                aria-hidden="true"
                className="size-[18px] shrink-0 text-muted-foreground"
              />
            </Link>

            {invite && (
              <>
                <div className="h-px bg-border" />
                <div className="flex flex-col gap-2.5 px-4 pt-3.5 pb-4">
                  <div className="flex items-center gap-2">
                    <Link2
                      aria-hidden="true"
                      className="size-[17px] shrink-0 text-muted-foreground"
                    />
                    <span className="flex-1 text-sm font-semibold">
                      {tInvite("heading")}
                    </span>
                    <span className="text-2xs font-medium text-muted-foreground">
                      <RemainingLabel
                        expiresAt={invite.expiresAt}
                        now={Date.parse(now)}
                        withVerb
                      />
                    </span>
                  </div>
                  <GuestLinkRow url={invite.url} groupName={groupName} />
                  <p className="text-xs leading-[1.4] text-pretty text-muted-foreground">
                    {t("inviteLinkNote")}
                  </p>
                </div>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
