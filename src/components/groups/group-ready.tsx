"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  CopyButton,
  ExpiryRow,
  LinkChip,
  ShareButton,
  useCanShare,
} from "@/components/groups/invite-link-controls";
import { remainingFor } from "@/modules/join/expiry";

/**
 * The moment after "Create group", and the only one where everybody the group
 * is for is still in the organiser's head.
 *
 * It exists because of what happens when it does not: the names typed into the
 * create sheet sit there unclaimed, the group's own people sign up separately
 * a week later, and the same person is in the group twice with half the
 * expenses each. So the screen hands over the link while the intent is still
 * warm, and says plainly what the hand-typed names are waiting for.
 *
 * Skippable, and it means it: the link is minted with the group and lives in
 * settings, so nothing here is the last chance to do anything.
 */
export function GroupReady({
  groupId,
  groupName,
  /** Everyone in the new group, the creator first. */
  people,
  invite,
  onSkip,
  heading: Heading = "h2",
}: {
  groupId: string;
  groupName: string;
  people: readonly string[];
  invite: { url: string; expiresAt: string | null } | null;
  onSkip: () => void;
  /**
   * What draws the title. The surface this is shown on decides: inside the
   * create sheet it has to be the sheet's own `SheetTitle`, because a dialog
   * that names itself twice names itself wrong, and a dialog that does not
   * name itself at all is worse.
   */
  heading?: React.ElementType;
}) {
  const t = useTranslations("inviteLink");
  const canShare = useCanShare();
  // Fixed when the screen opens: this view is only ever reached by tapping
  // "Create group", so there is no server render for it to disagree with.
  const [openedAt] = useState(() => new Date().toISOString());
  /*
   * The link's life, as the row below is currently showing it.
   *
   * The sheet minted this invite, handed it over and stopped listening: the
   * prop never moves again, however often the reader changes the expiry. That
   * was survivable while the sentence under the row only said "until then",
   * and is not now that it says a number — a row reading "Dans 24 heures"
   * above a line reading "reste valable 7 jours" is the screen contradicting
   * itself. So the row reports what the reader picked, and the sentence
   * follows it rather than the prop.
   */
  const [expiry, setExpiry] = useState(() => ({
    expiresAt: invite?.expiresAt ?? null,
    at: Date.parse(openedAt),
  }));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[22px] overflow-y-auto px-5 pt-7 pb-6 motion-safe:animate-in motion-safe:duration-200 motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1">
      <div className="flex flex-col items-start gap-3">
        <span className="flex size-12 items-center justify-center rounded-full bg-positive/15 text-positive">
          <Check aria-hidden="true" className="size-[22px]" />
        </span>
        <Heading className="font-heading text-2xl leading-tight font-semibold tracking-[-0.02em] text-pretty">
          {t("ready.title")}
        </Heading>
        <p className="text-sm text-pretty text-muted-foreground">
          {lede(t, people)}
        </p>
      </div>

      {invite && (
        <Card className="gap-3 p-4">
          <span className="text-2xs font-medium tracking-[0.05em] text-muted-foreground uppercase">
            {t("heading")}
          </span>
          <div className="flex items-center gap-2">
            <LinkChip url={invite.url} className="flex-1" />
            <CopyButton url={invite.url} className="shrink-0" />
          </div>
          <ExpiryRow
            groupId={groupId}
            label={t("linkExpires")}
            expiresAt={invite.expiresAt}
            now={openedAt}
            onChange={(expiresAt, at) => setExpiry({ expiresAt, at })}
          />
          <p className="text-xs text-pretty text-muted-foreground">
            {expiryNote(t, expiry.expiresAt, expiry.at)}
          </p>
        </Card>
      )}

      {/*
        The explainer earns its place: claiming is the one thing about this
        link that is not obvious from the link, and it is the thing that stops
        the group ending up with two of everybody.
      */}
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 rounded-lg border border-border bg-card px-3.5 py-3">
        <Users
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        />
        <p className="text-sm leading-snug font-medium">{t("noDuplicates")}</p>
        <p className="col-start-2 text-sm text-pretty text-muted-foreground">
          {t("noDuplicatesBody")}
        </p>
      </div>

      <div className="mt-auto flex flex-col gap-2.5 pt-2">
        {invite &&
          (canShare === false ? (
            <CopyButton
              url={invite.url}
              variant="default"
              label={t("copyTheLink")}
              className="h-[46px] w-full"
            />
          ) : (
            <ShareButton
              url={invite.url}
              groupName={groupName}
              className="h-[46px] w-full"
            >
              {t("shareTheLink")}
            </ShareButton>
          ))}
        <Button
          type="button"
          variant="ghost"
          className="h-[46px] w-full"
          onClick={onSkip}
        >
          {t("skip")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Who the link is for, named.
 *
 * Two names and a count rather than the whole list: five names wrap to three
 * lines and stop being read, while "and 3 others" is still true and still
 * tells the organiser the screen knows who they typed. A group of one has
 * nobody to name yet, so it gets the sentence that describes the link instead.
 */
function lede(
  t: ReturnType<typeof useTranslations<"inviteLink">>,
  people: readonly string[],
): string {
  const [first, second, ...rest] = people;
  if (!second) return t("ready.ledeAlone");
  return t("ready.lede", {
    people:
      rest.length === 0
        ? t("ready.peopleTwo", { first, second })
        : t("ready.peopleMany", { first, second, count: rest.length }),
  });
}

/**
 * How long the link the organiser is holding lasts, in days.
 *
 * The row above counts down in the units a person would say it in — hours,
 * under two days — because it answers "when does this die". This sentence
 * answers "how long have I got", where "24 heures" and "1 jour" are the same
 * promise said twice, so it rounds hours up into a day and leaves the exact
 * deadline to the row.
 *
 * `expired` cannot happen here: every date this can be handed is one the
 * group was just created with or the reader just picked, and both are ahead
 * of the clock they are measured against.
 */
function expiryNote(
  t: ReturnType<typeof useTranslations<"inviteLink">>,
  expiresAt: string | null,
  /** Epoch milliseconds. See `ExpiryRow` for why this travels with the date. */
  now: number,
): string {
  if (expiresAt === null) return t("expiryNoteNever");
  const remaining = remainingFor(new Date(expiresAt), new Date(now));
  return t("expiryNote", {
    count:
      remaining.kind === "hours"
        ? Math.ceil(remaining.count / 24)
        : remaining.kind === "days"
          ? remaining.count
          : 1,
  });
}
