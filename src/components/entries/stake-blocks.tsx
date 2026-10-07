import { getTranslations } from "next-intl/server";
import { toneFor } from "@/components/money/balance-tone";
import { formatMoney, money } from "@/modules/currencies/money";
import {
  DetailCard,
  SplitList,
  SplitRow,
  SplitTableRow,
  SplitTableShell,
  StakeLine,
  StakeTone,
} from "./detail-blocks";
import { impactOf, stakeOf, sumFor, type EntryParties } from "./stake";

/**
 * The two places the entry detail says what an expense or an income did to
 * the people in it: the reader's own line under the total, and the split.
 *
 * Both are worded here, on the server, from the payers and shares alone — see
 * `stake.ts` for the arithmetic. Every figure is in the entry's own currency,
 * the one the rest of the screen is in: in a group that converts, the strip
 * under the total says what it came to in the group's.
 */

interface StakeProps {
  entry: EntryParties;
  /** The reader's participant, or null for a member with no place in the money. */
  participantId: string | null;
  /** The entry's own currency. */
  currency: string;
  /** The reader's number notation. */
  locale: string;
}

/**
 * A magnitude inside a sentence.
 *
 * `Amount` is a client component and cannot be interpolated into an ICU
 * message, so the figure is formatted here with the locale that component
 * would have read from context — the same thing the repayment screen does.
 * The direction is in the words around it, so the figure never carries a sign.
 */
function formatAmount(
  minorUnits: bigint,
  currency: string,
  locale: string,
): string {
  const magnitude = minorUnits < 0n ? -minorUnits : minorUnits;
  return formatMoney(money(magnitude, currency), { locale });
}

/**
 * The reader's part in the entry, as one sentence under its total.
 *
 * Each case is a whole message rather than a sentence put together from
 * pieces, so a translator sees "You paid {paid} · you get back {amount}" and
 * can reorder all of it. The `<tone>` tag marks the half that carries a
 * direction, which is the only half coloured.
 */
export async function YourStake({
  entry,
  participantId,
  currency,
  locale,
}: StakeProps) {
  const t = await getTranslations("transactionDetail.stake");
  const revenue = entry.direction === "in";
  const stake = stakeOf(entry, participantId);

  if (stake.kind === "none") {
    return (
      <StakeLine quiet>
        {t("notInvolved", { kind: revenue ? "revenue" : "expense" })}
      </StakeLine>
    );
  }

  const amount = formatAmount(stake.net, currency, locale);
  const tone = (chunks: React.ReactNode) => (
    <StakeTone tone={toneFor(stake.net)}>{chunks}</StakeTone>
  );

  if (stake.kind === "other") {
    return (
      <StakeLine>
        {t.rich(revenue ? "othersReceived" : "othersPaid", {
          count: stake.payers.length,
          name: stake.payers[0] ?? "",
          amount,
          tone,
        })}
      </StakeLine>
    );
  }

  // What they put in — or, on income, what they were handed.
  const put = formatAmount(stake.paid, currency, locale);
  const direction =
    stake.net > 0n ? "GetBack" : stake.net < 0n ? "Owe" : "Even";

  return (
    <StakeLine>
      {revenue
        ? t.rich(`received${direction}` as const, {
            received: put,
            amount,
            tone,
          })
        : t.rich(`paid${direction}` as const, { paid: put, amount, tone })}
    </StakeLine>
  );
}

/**
 * Who the entry was split between — or, on income, credited to — with what
 * it did to each of them, in words.
 *
 * You first: the row somebody came to this screen to read should not have to
 * be found among the others, and it speaks to you ("You get back €60.00")
 * where the others are spoken about ("Owes €30.00").
 */
export async function SplitCard({
  entry,
  participantId,
  currency,
  locale,
}: StakeProps) {
  const t = await getTranslations("transactionDetail");
  const revenue = entry.direction === "in";
  const figureLabel = t(revenue ? "credited" : "share");

  const shares = [...entry.shares].sort((left, right) => {
    if (left.participantId === right.participantId) return 0;
    if (left.participantId === participantId) return -1;
    if (right.participantId === participantId) return 1;
    return 0;
  });

  // An entry everybody paid their own part of moved nobody; a line under
  // each name saying so would be the same words three times.
  const moved = shares.some(
    (share) => impactOf(entry, share.participantId) !== 0n,
  );

  const outcomeOf = outcomeWords(t, entry, currency, locale);

  return (
    <DetailCard>
      <SplitList figureLabel={figureLabel}>
        {shares.map((share) => {
          const you = share.participantId === participantId;
          const impact = impactOf(entry, share.participantId);
          return (
            <SplitRow
              key={share.participantId}
              name={share.displayName}
              tone={you ? "self" : "other"}
              minorUnits={share.amount.toString()}
              currency={currency}
              figureLabel={figureLabel}
              outcome={
                moved
                  ? { text: outcomeOf(impact, you), tone: toneFor(impact) }
                  : null
              }
            />
          );
        })}
      </SplitList>
    </DetailCard>
  );
}

/**
 * The same split as a table, for a desk window — see `SplitTableShell` for
 * why it is a table there and a list on a phone.
 *
 * One row per person the entry touched: everybody with a share, then anybody
 * who paid (or, on income, received the money) without having one, who on a
 * phone is only under "Paid by". The reader first, as in the list, and spoken
 * to the same way: "You owe €21.40" on their row, "Owes €21.40" on the others.
 */
export async function SplitTable({
  entry,
  participantId,
  currency,
  locale,
  label,
}: StakeProps & {
  /** What the section calls the people: "Split between", "Credited to". */
  label: string;
}) {
  const t = await getTranslations("transactionDetail");
  const revenue = entry.direction === "in";

  // A payer down for nothing is a leftover of a multi-payer edit, not
  // somebody who paid — the same reading `stakeOf` takes.
  const payers = entry.payers.filter((payer) => payer.amount > 0n);

  const names = new Map<string, string>();
  for (const party of [...entry.shares, ...payers]) {
    if (!names.has(party.participantId)) {
      names.set(party.participantId, party.displayName);
    }
  }
  const people = [...names.keys()].sort((left, right) => {
    if (left === right) return 0;
    if (left === participantId) return -1;
    if (right === participantId) return 1;
    return 0;
  });

  const moved = people.some((id) => impactOf(entry, id) !== 0n);
  const outcomeOf = outcomeWords(t, entry, currency, locale);

  return (
    <SplitTableShell
      label={label}
      personLabel={t("table.person")}
      figureLabel={t(revenue ? "credited" : "share")}
      paidLabel={t(revenue ? "table.received" : "table.paid")}
      outcomeLabel={moved ? t("table.effect") : null}
    >
      {people.map((id) => {
        const you = id === participantId;
        const inSplit = entry.shares.some(
          (share) => share.participantId === id,
        );
        const paid = sumFor(payers, id);
        const impact = impactOf(entry, id);
        return (
          <SplitTableRow
            key={id}
            name={names.get(id) ?? ""}
            // You, whoever put the money in, or anybody else — the list's
            // faces, with the payer's amber the phone shows under "Paid by",
            // since the table is both.
            tone={you ? "self" : paid > 0n ? "payer" : "other"}
            share={inSplit ? sumFor(entry.shares, id).toString() : null}
            paid={paid > 0n ? paid.toString() : null}
            currency={currency}
            outcome={
              moved
                ? { text: outcomeOf(impact, you), tone: toneFor(impact) }
                : null
            }
          />
        );
      })}
    </SplitTableShell>
  );
}

type DetailTranslator = Awaited<
  ReturnType<typeof getTranslations<"transactionDetail">>
>;

/**
 * What an entry did to one person, in words: "You get back €60.00",
 * "Owes €30.00", "Paid their share". The list and the table say it the same
 * way, so it is worded once.
 */
function outcomeWords(
  t: DetailTranslator,
  entry: EntryParties,
  currency: string,
  locale: string,
): (impact: bigint, you: boolean) => string {
  const kind = entry.direction === "in" ? "revenue" : "expense";
  return (impact, you) => {
    const amount = formatAmount(impact, currency, locale);
    if (impact > 0n) {
      return you
        ? t("outcome.youGetBack", { amount })
        : t("outcome.getsBack", { amount });
    }
    if (impact < 0n) {
      return you
        ? t("outcome.youOwe", { amount })
        : t("outcome.owes", { amount });
    }
    return you ? t("outcome.youEven", { kind }) : t("outcome.even", { kind });
  };
}
