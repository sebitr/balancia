"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Archive, ChevronDown, ChevronUp, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useKeyboardReveal } from "@/components/ui/use-keyboard-reveal";
import { GroupIconTile } from "@/components/groups/group-icon";
import type { GroupIcon, GroupIconColor } from "@/modules/groups/icons";
import { RelativeTime } from "./relative-time";
import { PUSH } from "@/components/motion/transitions";

/**
 * The quiet end of the list: groups nobody owes anything in, then the archived
 * ones behind a row that opens them.
 *
 * These are rows in the same list as every other section, dimmed one step, so
 * the screen is one list from top to bottom rather than a list that trails off
 * into text. The dimming is the muted tile and the absent amount — never a
 * lighter name, which would read as disabled.
 *
 * The only client state on this screen lives here — whether the search field
 * has been revealed, what has been typed into it, and whether the archived
 * rows are open. Everything else is server-rendered, so this island stays
 * small.
 */

export interface SettledGroupView {
  readonly id: string;
  readonly name: string;
  readonly icon: GroupIcon | null;
  readonly iconColor: GroupIconColor | null;
  readonly participantCount: number;
  readonly lastActivityAt: string;
}

export function SettledGroups({
  settled,
  archived,
  now,
}: {
  settled: readonly SettledGroupView[];
  archived: readonly SettledGroupView[];
  now: string;
}) {
  const t = useTranslations("dashboard");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [archivedOpen, setArchivedOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // The search field is the last thing on the screen, so a phone keyboard
  // opens straight over it and over the rows it is there to narrow down.
  const keyboardRoom = useKeyboardReveal(inputRef, searchOpen);

  const needle = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      needle === ""
        ? settled
        : settled.filter((group) => group.name.toLowerCase().includes(needle)),
    [needle, settled],
  );

  return (
    <>
      {settled.length > 0 && (
        <section>
          <div className="flex items-center justify-between gap-3 pb-2.5">
            <h3 className="text-[0.6875rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              {t("sectionSettled", { count: settled.length })}
            </h3>
            {!searchOpen && (
              // The fill is what makes this an affordance: a bare icon out
              // here read as decoration and was missed.
              <button
                type="button"
                onClick={() => {
                  setSearchOpen(true);
                  requestAnimationFrame(() => inputRef.current?.focus());
                }}
                aria-label={t("searchLabel")}
                className="-my-[7px] inline-flex size-[30px] shrink-0 items-center justify-center rounded-[9px] bg-foreground/[0.06] text-muted-foreground transition-colors hover:bg-foreground/[0.12] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <Search aria-hidden="true" className="size-[15px]" />
              </button>
            )}
          </div>

          {searchOpen && (
            <div className="pb-2.5">
              <Input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label={t("searchLabel")}
                placeholder={t("searchPlaceholder", { count: settled.length })}
                onBlur={() => {
                  if (query.trim() === "") setSearchOpen(false);
                }}
                className="h-[34px] rounded-xl text-[0.8125rem]"
              />
            </div>
          )}

          <ul>
            {shown.length === 0 ? (
              <li className="border-t py-3.5 text-sm text-muted-foreground">
                {t("noMatch", { query: query.trim() })}
              </li>
            ) : (
              shown.map((group) => (
                <QuietRow
                  key={group.id}
                  group={group}
                  word={t("settledWord")}
                  meta={
                    <>
                      {t("peopleCount", { count: group.participantCount })}
                      {" · "}
                      <RelativeTime value={group.lastActivityAt} now={now} />
                    </>
                  }
                />
              ))
            )}
          </ul>
        </section>
      )}

      {archived.length > 0 && (
        <section className={settled.length > 0 ? "-mt-[26px]" : undefined}>
          <button
            type="button"
            onClick={() => setArchivedOpen((open) => !open)}
            aria-expanded={archivedOpen}
            className="flex w-full items-center gap-2.5 border-t py-3.5 text-left text-[0.8125rem] text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Archive aria-hidden="true" className="size-[15px] shrink-0" />
            <span className="flex-1">
              {t("archivedGroups", { count: archived.length })}
            </span>
            {archivedOpen ? (
              <ChevronUp aria-hidden="true" className="size-[15px] shrink-0" />
            ) : (
              <ChevronDown
                aria-hidden="true"
                className="size-[15px] shrink-0"
              />
            )}
          </button>

          {archivedOpen && (
            <ul>
              {archived.map((group) => (
                <QuietRow
                  key={group.id}
                  group={group}
                  word={t("archivedWord")}
                />
              ))}
            </ul>
          )}
        </section>
      )}

      {/* What the page scrolls against to get the field out from under the
          keyboard: below the last row, there is otherwise nothing left to
          scroll through. Gone the moment the keyboard is. */}
      {keyboardRoom > 0 && (
        <div
          data-slot="keyboard-room"
          aria-hidden="true"
          style={{ height: keyboardRoom }}
        />
      )}
    </>
  );
}

/**
 * A group with nothing outstanding: the active row's anatomy, one step down.
 *
 * The right column carries a word rather than an amount. It is a plain
 * quantity and not a balance — there is no direction to point at — so it takes
 * neither an arrow nor a tint, and the design system's word-icon-colour rule
 * does not apply.
 */
function QuietRow({
  group,
  word,
  meta,
}: {
  group: SettledGroupView;
  word: string;
  meta?: React.ReactNode;
}) {
  return (
    <li className="border-t">
      <Link
        href={`/groups/${group.id}`}
        transitionTypes={PUSH}
        className="flex items-center gap-3 py-3.5 transition-colors hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:translate-y-px motion-reduce:transition-none motion-reduce:active:translate-y-0"
      >
        <GroupIconTile
          icon={group.icon}
          color={group.iconColor}
          name={group.name}
          muted
          className="size-10 rounded-xl bg-foreground/[0.05] text-neutral-balance"
          iconClassName="size-[19px]"
        />
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="truncate text-base font-medium tracking-[-0.01em]">
            {group.name}
          </span>
          {meta && (
            <span className="text-xs text-muted-foreground">{meta}</span>
          )}
        </span>
        <span className="shrink-0 text-[0.8125rem] text-neutral-balance">
          {word}
        </span>
      </Link>
    </li>
  );
}
