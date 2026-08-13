"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

/**
 * The quiet end of the list: groups nobody owes anything in, plus the archived
 * ones behind a link.
 *
 * The only client state on this screen lives here — whether the search field
 * has been revealed, and what has been typed into it. Everything else is
 * server-rendered, so this island stays small.
 */

export interface SettledGroupView {
  readonly id: string;
  readonly name: string;
}

export function SettledGroups({
  settled,
  archived,
}: {
  settled: readonly SettledGroupView[];
  archived: readonly SettledGroupView[];
}) {
  const t = useTranslations("dashboard");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [archivedOpen, setArchivedOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
              <button
                type="button"
                onClick={() => {
                  setSearchOpen(true);
                  // The affordance is only worth revealing if it is also ready
                  // to be typed into.
                  requestAnimationFrame(() => inputRef.current?.focus());
                }}
                className="-my-2 inline-flex shrink-0 items-center gap-1.5 rounded-md py-2 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <Search aria-hidden="true" className="size-[13px]" />
                {t("search")}
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

          {shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("noMatch", { query: query.trim() })}
            </p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {shown.map((group) => (
                <li key={group.id}>
                  <Link
                    href={`/groups/${group.id}`}
                    className="inline-flex h-[30px] items-center rounded-full border px-3 text-[0.8125rem] transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:translate-y-px motion-reduce:transition-none motion-reduce:active:translate-y-0"
                  >
                    {group.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {archived.length > 0 && (
        <section>
          <button
            type="button"
            onClick={() => setArchivedOpen((open) => !open)}
            aria-expanded={archivedOpen}
            className="-my-2 rounded-md py-2 text-[0.8125rem] font-medium text-primary transition-colors hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {t("archivedGroups", { count: archived.length })}
          </button>

          {archivedOpen && (
            <ul className="flex flex-wrap gap-1.5 pt-2.5">
              {archived.map((group) => (
                <li key={group.id}>
                  <Link
                    href={`/groups/${group.id}`}
                    className="inline-flex h-[30px] items-center rounded-full border px-3 text-[0.8125rem] text-muted-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    {group.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
