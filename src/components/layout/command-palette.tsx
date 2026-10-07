"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Plus, Search, Settings, WalletCards } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { MemberAvatar } from "@/components/entries/pills";
import {
  CATEGORY_GLYPHS,
  FALLBACK_GLYPH,
  TYPE_GLYPHS,
  hasGlyph,
} from "@/components/expenses/category-icon";
import type { RowView } from "@/components/expenses/list-filter";
import { GroupIconTile } from "@/components/groups/group-icon";
import { PUSH, SWITCH_FORWARD } from "@/components/motion/transitions";
import { rememberOrigin } from "@/components/settings/settings-origin";
import { useDateFormatter, useNumberLocale } from "@/i18n/format-context";
import type { NavigationGroup } from "@/modules/balances/navigation";
import { formatMoney, money } from "@/modules/currencies/money";
import { searchPaletteAction } from "@/modules/search/actions";
import type { PalettePerson, PaletteResults } from "@/modules/search/service";
import { cn } from "@/lib/utils";
import { useKnownGroups, usePositionLines } from "./sidebar-groups";
import { readSingleKeys } from "./single-keys";
import {
  commandHeld,
  isApplePlatform,
  pressShortcut,
  useShortcuts,
} from "./use-shortcuts";

/**
 * "Search or jump to": the command palette, from `lg` up.
 *
 * Opened by ⌘K (Ctrl K) anywhere in the app, or by the sidebar's Search. One
 * field over a list in four parts: the reader's **groups**, each with where
 * they stand in it in the sidebar's own words; the **transactions** of the
 * group they are in that match; the **people** in their groups; and the
 * **actions** this screen offers — add an expense, settle up, open settings.
 * An empty field lists the groups and the actions, which is most of what
 * anybody opens a palette to do.
 *
 * Every row is the real thing: a link to where it goes, or a button for the
 * one action that opens something over the screen rather than going anywhere.
 * The field keeps the focus and points at the row ↑ and ↓ have reached with
 * `aria-activedescendant`, which is the combobox pattern a screen reader
 * expects — the rows are options of a listbox, so the field is never left to
 * find them. ↵ follows the row, ⌘↵ opens a link in a new tab, and Esc closes,
 * through the dialog it is drawn in, which closes only the topmost layer.
 *
 * Asked of the server once per pause in typing, through
 * `searchPaletteAction`. While the first answer is on its way the groups the
 * sidebar already holds stand in, so the palette opens on a list rather than
 * on a spinner; and the groups are narrowed in the browser as the reader
 * types, so they keep up with every key while the people and transactions
 * follow a beat later.
 *
 * Money keeps its rules here too: a group's position is the sidebar's phrase
 * in its tone's ink, and a transaction's total is the neutral figure the list
 * prints, never coloured.
 */

/** How long typing has to pause before the server is asked. */
const DEBOUNCE_MS = 150;

/** As many groups as the server lists; see `PALETTE_LIMITS`. */
const GROUP_LIMIT = 6;

/*
 * Whether the palette is open, kept outside React like the install sheet's
 * state (`pwa/use-install-prompt.ts`), because the two things that open it
 * cannot share a parent's state: the sidebar's Search is drawn deep inside
 * the shell, and the palette and its keys are mounted once beside it. A
 * context around the shell would do it too, at the price of re-indenting the
 * shell's every line under one more element for a boolean.
 *
 * `mounted` counts the palettes on the page — one, or two for the instant a
 * navigation swaps Home's shell for a group's — so Search can say whether
 * pressing it would open anything.
 */
let paletteOpen = false;
let mounted = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setPaletteOpen(open: boolean) {
  if (paletteOpen === open) return;
  paletteOpen = open;
  for (const listener of listeners) listener();
}

/** Opens "Search or jump to" — the sidebar's Search, and ⌘K. */
export function openCommandPalette(): void {
  if (mounted > 0) setPaletteOpen(true);
}

/**
 * Whether a palette is on the page for Search to open: always, inside the
 * app's shell. The server cannot know and draws the button pressable, as it
 * will be once the palette beside it has mounted.
 */
export function useCommandPaletteAvailable(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => mounted > 0,
    () => true,
  );
}

/**
 * The palette, and every key the shell answers: mounted once, by `AppShell`,
 * beside everything it draws.
 */
export function CommandPalette({
  group,
  isGuest,
}: {
  /** The group the screen belongs to, if it belongs to one. */
  group: { id: string; name: string } | null;
  isGuest: boolean;
}) {
  const t = useTranslations("nav");
  const open = useSyncExternalStore(
    subscribe,
    () => paletteOpen,
    () => false,
  );

  useEffect(() => {
    mounted += 1;
    for (const listener of listeners) listener();
    return () => {
      mounted -= 1;
      // The last palette to go takes its open state with it, so a shell
      // mounted later never opens on a palette nobody asked for.
      if (mounted === 0) paletteOpen = false;
      for (const listener of listeners) listener();
    };
  }, []);

  useShortcuts({
    groupId: group?.id ?? null,
    paletteOpen: open,
    setPaletteOpen,
  });

  /*
   * What to do once the palette has gone: the one action that opens a dialog
   * of its own waits for this one to finish closing, so the two never hold
   * the focus at once and the focus is not handed back to the sidebar a
   * moment after the new dialog took it. A link closes it plainly, and the
   * focus goes back to where it was before the palette opened.
   */
  const afterClose = useRef<(() => void) | null>(null);

  const closeThen = useCallback((action?: () => void) => {
    afterClose.current = action ?? null;
    setPaletteOpen(false);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setPaletteOpen}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          const action = afterClose.current;
          if (!action) return;
          afterClose.current = null;
          event.preventDefault();
          action();
        }}
        // In the upper part of the window and anchored by its top, so the
        // field stays where it is while the list under it grows and shrinks
        // with every key. 640px, as the board draws it.
        className="flex translate-y-0 flex-col gap-0 overflow-hidden rounded-[18px] p-0 shadow-xl ring-border sm:max-w-[40rem]"
        style={{ top: "6rem", maxHeight: "calc(100dvh - 8.5rem)" }}
      >
        <DialogTitle className="sr-only">
          {isGuest ? t("sidebarSearchGroup") : t("sidebarSearch")}
        </DialogTitle>
        <PaletteBody group={group} isGuest={isGuest} close={closeThen} />
      </DialogContent>
    </Dialog>
  );
}

type Option =
  | {
      readonly kind: "group";
      readonly key: string;
      readonly group: NavigationGroup;
    }
  | {
      readonly kind: "entry";
      readonly key: string;
      readonly row: RowView;
      readonly groupId: string;
      readonly self: string | null;
    }
  | {
      readonly kind: "person";
      readonly key: string;
      readonly person: PalettePerson;
    }
  | { readonly kind: "add"; readonly key: string; readonly label: string }
  | {
      readonly kind: "settle";
      readonly key: string;
      readonly label: string;
      readonly groupId: string;
    }
  | { readonly kind: "settings"; readonly key: string; readonly label: string };

interface Section {
  readonly key: string;
  readonly heading: string;
  readonly options: readonly Option[];
}

interface Answer {
  readonly query: string;
  readonly results?: PaletteResults;
  readonly error?: string;
}

/**
 * Everything inside the dialog. Mounted when it opens and gone when it
 * closes, so every opening starts from an empty field at the top of the list.
 */
function PaletteBody({
  group,
  isGuest,
  close,
}: {
  group: { id: string; name: string } | null;
  isGuest: boolean;
  /** Closes the palette, and then does `action` if there is one. */
  close: (action?: () => void) => void;
}) {
  const t = useTranslations("palette");
  const tNav = useTranslations("nav");
  const known = useKnownGroups();
  const listId = useId();
  const statusId = useId();

  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // Read once, as the palette opens: the switch lives on another screen.
  const [singleKeys] = useState(readSingleKeys);
  const [apple] = useState(isApplePlatform);

  const groupId = group?.id ?? null;

  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(
      async () => {
        try {
          const result = await searchPaletteAction({ query, groupId });
          if (!current) return;
          setAnswer(
            result.ok && result.data
              ? { query, results: result.data }
              : { query, error: result.error ?? t("failed") },
          );
        } catch {
          // The network, not the server: the action never answered.
          if (current) setAnswer({ query, error: t("failed") });
        }
      },
      query.trim() === "" ? 0 : DEBOUNCE_MS,
    );
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [query, groupId, t]);

  const needle = query.trim().toLowerCase();
  const pending = answer?.query !== query;
  const results = answer?.results ?? null;

  // The sidebar's list stands in until the first answer, and every list of
  // groups is narrowed here as well as on the server, so a key is answered at
  // once and the server only has to catch up with people and transactions.
  const groups = (results?.groups ?? known ?? [])
    .filter((one) => needle === "" || one.name.toLowerCase().includes(needle))
    .slice(0, GROUP_LIMIT);

  const sections: Section[] = [];
  if (groups.length > 0) {
    sections.push({
      key: "groups",
      heading: tNav("sidebarGroups"),
      options: groups.map((one) => ({
        kind: "group",
        key: `group-${one.id}`,
        group: one,
      })),
    });
  }
  const entries = needle === "" ? null : results?.entries;
  if (entries && entries.rows.length > 0) {
    sections.push({
      key: "entries",
      heading: t("transactionsIn", { group: entries.groupName }),
      options: entries.rows.map((row) => ({
        kind: "entry",
        key: `entry-${row.kind}-${row.id}`,
        row,
        groupId: entries.groupId,
        self: entries.self,
      })),
    });
  }
  const people = needle === "" ? [] : (results?.people ?? []);
  if (people.length > 0) {
    sections.push({
      key: "people",
      heading: tNav("people"),
      options: people.map((person) => ({
        kind: "person",
        key: `person-${person.id}`,
        person,
      })),
    });
  }

  // The actions this screen offers, narrowed by what was typed like
  // everything else — "settle" finds Settle up. Add outside a group asks
  // which group first, so it is only offered where there is a group to ask
  // about; a guest has no settings to open.
  const actions: Option[] = [];
  if (group) {
    actions.push({
      kind: "add",
      key: "add",
      label: t("addExpenseTo", { group: group.name }),
    });
    actions.push({
      kind: "settle",
      key: "settle",
      label: t("settleUpIn", { group: group.name }),
      groupId: group.id,
    });
  } else if (known === null || known.length > 0) {
    actions.push({ kind: "add", key: "add", label: t("addExpense") });
  }
  if (!isGuest) {
    actions.push({
      kind: "settings",
      key: "settings",
      label: t("openSettings"),
    });
  }
  const offered = actions.filter(
    (action) =>
      needle === "" ||
      ("label" in action && action.label.toLowerCase().includes(needle)),
  );
  if (offered.length > 0) {
    sections.push({ key: "actions", heading: t("actions"), options: offered });
  }

  const options = sections.flatMap((section) => section.options);
  const found = options.findIndex((option) => option.key === activeKey);
  const active = found === -1 ? 0 : found;
  const activeOption = options[active];
  const optionId = (option: Option) => `${listId}-${option.key}`;
  const activeId = activeOption ? optionId(activeOption) : undefined;

  // The row ↑ and ↓ reached stays in view when the list scrolls.
  useEffect(() => {
    if (!activeId) return;
    document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  const follow = (option: Option, newTab: boolean) => {
    const element = document.getElementById(optionId(option));
    if (!element) return;
    if (newTab && element instanceof HTMLAnchorElement) {
      window.open(element.href, "_blank", "noopener,noreferrer");
      return;
    }
    element.click();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (options.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = options[(active + step + options.length) % options.length];
      setActiveKey(next?.key ?? null);
      return;
    }
    if (event.key === "Enter" && activeOption) {
      event.preventDefault();
      follow(activeOption, commandHeld(event.nativeEvent));
    }
  };

  /*
   * A plain click on a link closes the palette and lets the link go. One
   * held for a new tab — ⌘, Ctrl, Shift or the middle button — is the
   * browser's, and the palette stays open behind it.
   */
  const onFollowLink = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    close();
  };

  // Said once the answer to what is in the field is in, and not while it is
  // on its way; an empty field has nothing to report.
  const nothing =
    !pending &&
    results !== null &&
    needle !== "" &&
    sections.every((section) => section.key === "actions");
  const notice =
    answer?.error ?? (nothing ? t("nothing", { query: query.trim() }) : null);
  const status =
    pending || needle === ""
      ? ""
      : (notice ?? t("resultCount", { count: options.length }));

  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b px-4">
        <Search
          aria-hidden="true"
          className="size-[18px] shrink-0 text-muted-foreground"
        />
        {/* The dialog puts the focus here as it opens: the rows are kept out
            of the tab order, so this is its first stop. */}
        <input
          type="text"
          role="combobox"
          aria-label={isGuest ? tNav("sidebarSearchGroup") : t("label")}
          aria-expanded={options.length > 0}
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          aria-describedby={statusId}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={
            isGuest ? tNav("sidebarSearchGroup") : tNav("sidebarSearch")
          }
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            // A new question starts again from the top of its answer.
            setActiveKey(null);
          }}
          onKeyDown={onKeyDown}
          className="h-full min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
        />
        <Key>Esc</Key>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">
        {/* Outside the list, which holds rows and nothing else; a screen
            reader hears it through the status line below. */}
        {notice && (
          <p className="px-4 pt-3 pb-1 text-sm text-pretty text-muted-foreground">
            {notice}
          </p>
        )}
        <div
          id={listId}
          role="listbox"
          aria-label={t("results")}
          aria-busy={pending || undefined}
        >
          {sections.map((section) => (
            <div
              key={section.key}
              role="group"
              aria-labelledby={`${listId}-${section.key}-heading`}
            >
              <div
                id={`${listId}-${section.key}-heading`}
                role="presentation"
                className="px-4 pt-2.5 pb-1 text-2xs font-semibold tracking-[0.08em] text-muted-foreground uppercase"
              >
                {section.heading}
              </div>
              {section.options.map((option) => (
                <OptionRow
                  key={option.key}
                  id={optionId(option)}
                  option={option}
                  active={option === activeOption}
                  currentGroupId={groupId}
                  singleKeys={singleKeys}
                  onPoint={() => setActiveKey(option.key)}
                  onFollowLink={onFollowLink}
                  onAdd={() => close(() => pressShortcut("n"))}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <p id={statusId} role="status" className="sr-only">
        {status}
      </p>

      {/* The keys the field answers, for the eye: a screen reader is told
          the same by the combobox it is in. */}
      <div
        aria-hidden="true"
        className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t bg-muted/35 px-4 py-2.5 text-xs text-muted-foreground"
      >
        <span className="inline-flex items-center gap-1.5">
          <Key>↑</Key>
          <Key>↓</Key>
          {t("move")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Key>↵</Key>
          {t("open")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Key>{apple ? "⌘" : "Ctrl"}</Key>
          <Key>↵</Key>
          {t("openNewTab")}
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5">
          <Key>Esc</Key>
          {t("close")}
        </span>
      </div>
    </>
  );
}

/**
 * One row of the list: 44px, lit with the sidebar's wash when it is the one ↵
 * follows — the same wash the sidebar lights the current place with, never
 * the accent and never a money colour.
 */
const ROW =
  "mx-2 flex min-h-11 items-center gap-3 rounded-[10px] px-2.5 py-1.5 text-left text-sm outline-none transition-colors motion-reduce:transition-none";

/**
 * What every row carries, link or button: an option of the listbox.
 *
 * A link here does not prefetch, which a `Link` in view otherwise does: the
 * list changes with every key, and each answer would ask the server for a
 * dozen screens of which the reader opens one.
 */
interface OptionProps {
  readonly id: string;
  readonly role: "option";
  readonly "aria-selected": boolean;
  readonly tabIndex: number;
  readonly onPointerMove: (() => void) | undefined;
  readonly className: string;
}

function OptionRow({
  id,
  option,
  active,
  currentGroupId,
  singleKeys,
  onPoint,
  onFollowLink,
  onAdd,
}: {
  id: string;
  option: Option;
  active: boolean;
  currentGroupId: string | null;
  singleKeys: boolean;
  onPoint: () => void;
  onFollowLink: (event: ReactMouseEvent<HTMLAnchorElement>) => void;
  onAdd: () => void;
}) {
  const shared: OptionProps = {
    id,
    role: "option",
    "aria-selected": active,
    tabIndex: -1,
    // Moving, not entering: a list that scrolls under a still pointer must
    // not steal the row the keyboard was on.
    onPointerMove: active ? undefined : onPoint,
    className: cn(
      ROW,
      active
        ? "bg-sidebar-accent text-sidebar-accent-foreground"
        : "text-foreground",
    ),
  };
  const enter = active && <EnterHint />;

  switch (option.kind) {
    case "group": {
      const isCurrent = option.group.id === currentGroupId;
      return (
        <GroupOption
          group={option.group}
          isCurrent={isCurrent}
          // Across to another group sideways, as the sidebar goes; into one
          // from outside any group, deeper.
          transitionTypes={
            isCurrent ? undefined : currentGroupId ? SWITCH_FORWARD : PUSH
          }
          shared={shared}
          onFollowLink={onFollowLink}
          trailing={enter}
        />
      );
    }
    case "entry":
      return (
        <Link
          {...shared}
          prefetch={false}
          href={
            option.row.kind === "settlement"
              ? `/groups/${option.groupId}/settlements/${option.row.id}`
              : `/groups/${option.groupId}/expenses/${option.row.id}`
          }
          transitionTypes={PUSH}
          onClick={onFollowLink}
        >
          <EntryContent row={option.row} self={option.self} />
          {enter}
        </Link>
      );
    case "person":
      return (
        <Link
          {...shared}
          prefetch={false}
          href={`/groups/${option.person.groupId}/members/${option.person.id}`}
          transitionTypes={PUSH}
          onClick={onFollowLink}
        >
          <MemberAvatar name={option.person.name} className="size-7" />
          <span className="flex min-w-0 flex-1 flex-col leading-snug">
            <span className="truncate font-medium">{option.person.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              {option.person.groupName}
            </span>
          </span>
          {enter}
        </Link>
      );
    case "add":
      return (
        <button
          {...shared}
          type="button"
          aria-haspopup="dialog"
          aria-keyshortcuts={singleKeys ? "N" : undefined}
          onClick={onAdd}
        >
          <ActionGlyph icon={Plus} />
          <span className="min-w-0 flex-1 truncate">{option.label}</span>
          {singleKeys && <Key>N</Key>}
        </button>
      );
    case "settle":
      return (
        <Link
          {...shared}
          prefetch={false}
          href={`/groups/${option.groupId}/settle`}
          transitionTypes={PUSH}
          aria-keyshortcuts={singleKeys ? "S" : undefined}
          onClick={onFollowLink}
        >
          <ActionGlyph icon={WalletCards} />
          <span className="min-w-0 flex-1 truncate">{option.label}</span>
          {singleKeys && <Key>S</Key>}
        </Link>
      );
    case "settings":
      return (
        <Link
          {...shared}
          prefetch={false}
          href="/settings"
          transitionTypes={PUSH}
          onClick={(event) => {
            // So the ✕ in settings comes back to this screen.
            rememberOrigin();
            onFollowLink(event);
          }}
        >
          <ActionGlyph icon={Settings} />
          <span className="min-w-0 flex-1 truncate">{option.label}</span>
          {enter}
        </Link>
      );
  }
}

function GroupOption({
  group,
  isCurrent,
  transitionTypes,
  shared,
  onFollowLink,
  trailing,
}: {
  group: NavigationGroup;
  isCurrent: boolean;
  transitionTypes: string[] | undefined;
  shared: OptionProps;
  onFollowLink: (event: ReactMouseEvent<HTMLAnchorElement>) => void;
  trailing: ReactNode;
}) {
  const lines = usePositionLines(group);
  return (
    <Link
      {...shared}
      prefetch={false}
      href={`/groups/${group.id}`}
      transitionTypes={transitionTypes}
      // The lines are told apart on screen by the dots between them; said
      // aloud, with the pauses written in, as the sidebar's row says them.
      aria-label={[group.name, ...lines.map((line) => line.text)].join(", ")}
      onClick={onFollowLink}
    >
      <GroupIconTile
        icon={group.icon}
        color={group.iconColor}
        name={group.name}
        muted={isCurrent}
        className={cn(
          "size-7 rounded-[9px] text-2xs font-semibold",
          isCurrent
            ? "bg-primary text-primary-foreground"
            : "bg-accent text-accent-foreground",
        )}
        iconClassName="size-[15px]"
      />
      <span className="flex min-w-0 flex-1 flex-col leading-snug">
        <span className="truncate font-medium">{group.name}</span>
        <span className="truncate text-xs tabular-nums">
          {lines.map((line, index) => (
            <span key={line.key}>
              {index > 0 && <span className="text-muted-foreground"> · </span>}
              {/* The tone's ink — text, never the fill, never the accent. */}
              <span className={line.ink}>{line.text}</span>
            </span>
          ))}
        </span>
      </span>
      {trailing}
    </Link>
  );
}

/**
 * A transaction as the palette lists it: what it was, the day, who paid, and
 * its total — the list's own facts, in a line.
 */
function EntryContent({ row, self }: { row: RowView; self: string | null }) {
  const t = useTranslations("palette");
  const dates = useDateFormatter();
  const locale = useNumberLocale();
  const repayment = row.kind === "settlement";

  const Glyph = repayment
    ? TYPE_GLYPHS.settlement
    : row.revenue
      ? TYPE_GLYPHS.revenue
      : hasGlyph(row.category)
        ? CATEGORY_GLYPHS[row.category]
        : FALLBACK_GLYPH;

  // The year only when it is not this one, as the transactions table writes
  // a day.
  const date =
    row.date.slice(0, 4) === String(new Date().getFullYear())
      ? dates.plain(row.date, "dayMonth")
      : dates.plain(row.date);

  // A repayment's title already names who paid whom.
  const paid = repayment
    ? null
    : t("paidLine", {
        who:
          self !== null && row.payers.length === 1 && row.payers[0] === self
            ? "you"
            : self !== null && row.payers.includes(self)
              ? "withYou"
              : "other",
        names: new Intl.ListFormat(locale, {
          style: "long",
          type: "conjunction",
        }).format(
          row.payers.map((payer, index) =>
            payer === self ? t("you") : (row.payerNames[index] ?? ""),
          ),
        ),
        count: row.payers.length,
      });

  return (
    <>
      <Glyph
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="min-w-0 truncate">
          <span className="font-medium">{row.title}</span>
          <span className="text-xs text-muted-foreground">
            {" · "}
            {date}
            {paid && ` · ${paid}`}
          </span>
        </span>
        {(repayment || row.revenue) && (
          <span
            className={cn(
              "inline-flex h-[18px] shrink-0 items-center rounded-full px-2 text-2xs font-semibold",
              repayment
                ? "border text-foreground"
                : "bg-positive/15 text-positive-ink",
            )}
          >
            {repayment ? t("repayment") : t("income")}
          </span>
        )}
      </span>
      {/* The total, in neutral ink: what the entry was for, not where anybody
          stands — the same figure the list's Amount column prints. */}
      <span className="shrink-0 font-medium tabular-nums">
        {formatMoney(money(BigInt(row.amount), row.currency), { locale })}
      </span>
    </>
  );
}

function ActionGlyph({ icon: Icon }: { icon: typeof Plus }) {
  return (
    <span className="flex size-7 shrink-0 items-center justify-center">
      <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
    </span>
  );
}

function EnterHint() {
  return <Key>↵</Key>;
}

/**
 * A key, drawn as the sidebar draws ⌘K: mono at the foot of the scale, on the
 * card with a hairline and a one-pixel lip.
 *
 * Always beside words that already say what the key does, so it is hidden
 * from a screen reader. Local until the entry dialog's `ui/kbd.tsx` lands on
 * main, which is the same drawing.
 */
function Key({ children }: { children: ReactNode }) {
  return (
    <kbd
      aria-hidden="true"
      className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md bg-card px-1 font-mono text-2xs font-medium text-muted-foreground shadow-[inset_0_0_0_1px_var(--border),0_1px_0_var(--border)]"
    >
      {children}
    </kbd>
  );
}
