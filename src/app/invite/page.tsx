import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Check, Minus } from "lucide-react";
import { Wordmark } from "@/components/brand/wordmark";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BalanceAmount } from "@/components/money/amount";
import { initialOf } from "@/components/entries/initials";
import { getDateFormatter } from "@/i18n/preferences";
import { requireGroupAccess } from "@/lib/actions";
import { getCurrentActor } from "@/lib/security/actor";
import { getEnv } from "@/lib/env";
import { describeGuestSession } from "@/modules/guests/service";
import { loadGroupOverview } from "@/modules/groups/overview";

/**
 * Where an invitation link lands.
 *
 * The token is already gone by the time this renders: `/join/[token]` spends
 * it, sets the session cookie and redirects here, so the address bar, history
 * and any referrer carry nothing. This screen reads that cookie and does the
 * introducing — who invited them, what the group is, what they are owed — then
 * offers the three ways in.
 *
 * All three keep the guest session. "Create an account" and "I already have an
 * account" both lead somewhere that claims it on success, so nothing this
 * person does as a guest is stranded by choosing one over another.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("invite");
  return { title: t("metaTitle") };
}

export default async function InvitePage() {
  const actor = await getCurrentActor();
  // A signed-in reader has no guest identity to introduce, and someone with no
  // session at all reached this URL without a link.
  if (actor?.kind === "user") redirect("/dashboard");
  if (!actor) redirect("/join/error?reason=invalid");

  const access = await requireGroupAccess(actor.groupId);
  const [overview, invitation] = await Promise.all([
    loadGroupOverview(access),
    describeGuestSession(actor.sessionId),
  ]);

  const t = await getTranslations("invite");
  const tGroup = await getTranslations("group");
  const dates = await getDateFormatter();
  const env = getEnv();

  const meta = [
    tGroup("metaPeople", { count: overview.participantCount }),
    tGroup("metaExpenses", { count: overview.expenseCount }),
    overview.span
      ? tGroup("metaSpan", {
          first: dates.plain(overview.span.first),
          last: dates.plain(overview.span.last),
        })
      : null,
  ].filter((part): part is string => part !== null);

  // One currency, one counterparty: the case a sentence can carry. Anything
  // busier belongs on the group's own screens, a tap away.
  const position = overview.positions[0] ?? null;
  const only =
    position?.counterparties.length === 1 ? position.counterparties[0] : null;

  const inviter = invitation.inviterName ?? actor.displayName;
  const initial = initialOf(inviter);

  const promises = [
    { key: "promiseExpenses", kept: true },
    { key: "promiseAdd", kept: true },
    { key: "promiseNoEmail", kept: false },
  ] as const;

  return (
    <div className="flex min-h-dvh flex-col justify-between gap-8 px-4 py-6">
      <div className="mx-auto flex w-full max-w-sm flex-col gap-5">
        <Wordmark />

        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Avatar size="sm">
              <AvatarFallback className="bg-accent text-accent-foreground">
                {initial}
              </AvatarFallback>
            </Avatar>
            <p className="text-sm text-muted-foreground">
              {invitation.inviterName
                ? t("invitedBy", {
                    inviter: invitation.inviterName,
                    name: actor.displayName,
                  })
                : t("invited", { name: actor.displayName })}
            </p>
          </div>
          <h1 className="mt-1 font-heading text-[1.75rem] leading-tight font-semibold tracking-[-0.025em]">
            {access.group.name}
          </h1>
          <p className="text-xs text-muted-foreground">{meta.join(" · ")}</p>
        </div>

        {position && (
          <Card className="gap-1.5 p-4">
            <p className="text-sm text-muted-foreground">{t("balanceLabel")}</p>
            <BalanceAmount
              minorUnits={position.amount.toString()}
              currency={position.currency}
              size="large"
              showLabel={false}
            />
            {only && (
              <p className="text-xs text-muted-foreground">
                {position.amount < 0n
                  ? t("balanceTo", { name: only.name })
                  : t("balanceFrom", { name: only.name })}
              </p>
            )}
          </Card>
        )}

        <ul className="flex flex-col gap-2">
          {promises.map((promise) => (
            <li
              key={promise.key}
              className="flex items-center gap-2 text-sm text-muted-foreground"
            >
              {promise.kept ? (
                <Check aria-hidden="true" className="size-4 text-positive" />
              ) : (
                <Minus aria-hidden="true" className="size-4" />
              )}
              {t(promise.key)}
            </li>
          ))}
        </ul>
      </div>

      <div className="mx-auto flex w-full max-w-sm flex-col gap-2.5">
        <Button asChild size="lg">
          <Link href={`/groups/${access.groupId}`}>{t("continueAsGuest")}</Link>
        </Button>
        {env.ALLOW_REGISTRATION && (
          <Button asChild variant="outline" size="lg">
            <Link href="/register">{t("createAccount")}</Link>
          </Button>
        )}
        <Button asChild variant="outline" size="lg">
          <Link href="/sign-in">{t("haveAccount")}</Link>
        </Button>
      </div>
    </div>
  );
}
