"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ChevronRight, Loader2, Lock, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CurrencyPicker } from "@/components/money/currency-picker";
import { currencyEntry } from "@/modules/currencies/catalog";
import { GroupIconPicker } from "@/components/groups/group-icon-picker";
import { GroupReady } from "@/components/groups/group-ready";
import { GroupIconTile } from "@/components/groups/group-icon";
import { useDetectedTimezone } from "@/components/groups/use-detected-timezone";
import {
  createGroupAction,
  type CreatedGroupResult,
} from "@/modules/groups/actions";
import {
  DEFAULT_GROUP_ICON_COLOR,
  type GroupIcon,
  type GroupIconColor,
} from "@/modules/groups/icons";
import type { CurrencyMode } from "@/modules/currencies/conversion";
import { timezoneCity } from "@/lib/timezones";
import { cn } from "@/lib/utils";

interface Member {
  readonly name: string;
  /** The creator, who is always first and cannot be removed. */
  readonly you: boolean;
}

/**
 * Creating a group, as a bottom sheet over the list it will join.
 *
 * The old screen asked six stacked questions and explained four of them. This
 * one asks for a name and gets out of the way: everything else carries a
 * usable default, so the shortest path through is type a name and confirm.
 *
 * The creator is the first participant row rather than a separate "your name
 * in this group" field — the list is then literally who is in the group,
 * which is the question people were answering anyway.
 */
export function CreateGroupSheet({
  open,
  onOpenChange,
  defaultName,
  defaultTimezone,
  defaultCurrency,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The current user's display name, seeding the first participant. */
  defaultName: string;
  defaultTimezone: string;
  /** The user's preferred currency, if they have one. */
  defaultCurrency: string;
}) {
  const router = useRouter();
  const t = useTranslations("groupForm");
  const nameId = useId();

  const [view, setView] = useState<"form" | "icon" | "currency" | "ready">(
    "form",
  );
  /** Set on success, which is also what swaps the sheet to the last view. */
  const [created, setCreated] = useState<CreatedGroupResult | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [descOpen, setDescOpen] = useState(false);
  const [members, setMembers] = useState<Member[]>([
    { name: defaultName, you: true },
  ]);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<CurrencyMode>("converted");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [icon, setIcon] = useState<GroupIcon | null>(null);
  const [color, setColor] = useState<GroupIconColor>(DEFAULT_GROUP_ICON_COLOR);
  const [pending, setPending] = useState(false);

  /*
   * Detected, stated in the footer, and never asked for. The zone decides one
   * thing — which day an expense lands on — and the device already knows the
   * answer, so a searchable list of four hundred zones was a question with a
   * right answer already in it. Correcting it lives in the group's settings,
   * where the handful of groups that need to are.
   */
  const detected = useDetectedTimezone();
  const timezone = detected ?? defaultTimezone;

  const draftRef = useRef<HTMLInputElement>(null);

  const addMember = () => {
    const value = draft.trim();
    if (value === "") return;
    setMembers((current) => [...current, { name: value, you: false }]);
    setDraft("");
    draftRef.current?.focus();
  };

  const onSubmit = async (formData: FormData) => {
    setPending(true);
    try {
      const result = await createGroupAction(formData);
      if (!result.ok || !result.data) {
        toast.error(result.error ?? t("failed"));
        return;
      }
      /*
       * The group exists now, so the sheet stops being a form and becomes the
       * handover: the same surface, one view further along. It is not closed
       * and re-opened as something else, because the names on the screen
       * behind it are the names the next view is about to talk about.
       *
       * No toast. The whole view is the confirmation.
       */
      setCreated(result.data);
      setView("ready");
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  /**
   * Leaving the handover, by any of its three exits — Skip, the close button,
   * a swipe. All of them mean the same thing: the group is made, take me to
   * it. Closing on the form instead is an abandoned draft and goes nowhere.
   */
  const leave = (groupId: string) => {
    onOpenChange(false);
    router.push(`/groups/${groupId}`);
  };

  const ready = name.trim() !== "";

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && created) {
          leave(created.groupId);
          return;
        }
        onOpenChange(next);
      }}
    >
      <SheetContent
        side="bottom"
        showCloseButton={false}
        // The sheet is the scroll container the swipe-to-dismiss gesture reads,
        // so the body scrolls inside it and the chrome stays put.
        //
        // The 48px gap is measured from the bottom of the safe area, and the
        // `max-h` repeats the limit in `%` and `calc` alone so that losing
        // `dvh` or `min()` cannot drop the height and leave the sheet at its
        // content's height. Both for the reasons written out in
        // `add-entry-drawer`, which is the same sheet in a different hat.
        className="h-[min(800px,calc(100dvh-48px-env(safe-area-inset-top)))] max-h-[calc(100%-48px-env(safe-area-inset-top))] gap-0 overflow-hidden rounded-t-[28px] bg-card pt-2.5 text-card-foreground"
      >
        {view === "form" ? (
          <form
            action={onSubmit}
            noValidate
            className="flex min-h-0 flex-1 flex-col motion-safe:animate-in motion-safe:fade-in-0"
          >
            <header className="flex shrink-0 items-center gap-3 px-5 pt-2.5 pb-3.5">
              <SheetTitle className="flex-1 text-xl font-semibold tracking-[-0.02em]">
                {t("sheetTitle")}
              </SheetTitle>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="tap-target flex size-8 items-center justify-center rounded-full bg-wash-2 text-muted-foreground transition-colors duration-150 hover:bg-wash-4 hover:text-foreground"
              >
                <X aria-hidden="true" className="size-4" />
                <span className="sr-only">{t("close")}</span>
              </button>
            </header>

            <div className="flex min-h-0 flex-1 flex-col gap-[22px] overflow-y-auto px-5 pb-3">
              <IdentityRow
                nameId={nameId}
                name={name}
                onName={setName}
                icon={icon}
                color={color}
                onOpenIcons={() => setView("icon")}
                descOpen={descOpen}
                description={description}
                onDescription={setDescription}
                onOpenDescription={() => setDescOpen(true)}
              />

              <Participants
                members={members}
                draft={draft}
                draftRef={draftRef}
                onDraft={setDraft}
                onAdd={addMember}
                onRemove={(index) =>
                  setMembers((current) =>
                    current.filter((_, position) => position !== index),
                  )
                }
              />

              <CurrencyQuestion
                mode={mode}
                onMode={setMode}
                currency={currency}
                onOpenCurrency={() => setView("currency")}
              />
            </div>

            {/* What the server needs that no visible control submits. */}
            <input type="hidden" name="icon" value={icon ?? ""} />
            <input type="hidden" name="iconColor" value={color} />
            <input type="hidden" name="currencyMode" value={mode} />
            {/*
             * Only the mode that has one. The code stays in state either way,
             * so switching back and forth does not lose it, but a separate
             * group is submitted without a base currency — which is what it
             * has.
             */}
            {mode === "converted" && (
              <input type="hidden" name="baseCurrency" value={currency} />
            )}
            <input type="hidden" name="timezone" value={timezone} />
            <input
              type="hidden"
              name="ownerDisplayName"
              value={members[0]?.name ?? defaultName}
            />
            {members
              .filter((member) => !member.you)
              .map((member, index) => (
                <input
                  key={`${member.name}-${index}`}
                  type="hidden"
                  name="participantNames"
                  value={member.name}
                />
              ))}

            <footer className="flex shrink-0 flex-col gap-2 bg-linear-to-t from-card from-62% to-transparent px-5 pt-3 pb-[22px]">
              {/*
               * The zone, said rather than asked. It sits by the button
               * because that is the last thing read before committing, and it
               * names the city rather than the IANA zone — nobody recognises
               * `Europe/Zurich` faster than they recognise Zurich.
               */}
              <p className="text-xs text-pretty text-muted-foreground">
                {t("timezoneFootnote", { city: timezoneCity(timezone) })}
              </p>
              <button
                type="submit"
                disabled={!ready || pending}
                className={cn(
                  "flex h-[50px] w-full items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground transition-opacity duration-200",
                  "hover:brightness-105 active:translate-y-px",
                  ready ? "opacity-100" : "opacity-45",
                )}
              >
                {pending && (
                  <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                )}
                {t("submit")}
              </button>
            </footer>
          </form>
        ) : view === "ready" && created ? (
          <GroupReady
            groupId={created.groupId}
            groupName={name.trim()}
            people={members.map((member) => member.name)}
            invite={created.invite}
            onSkip={() => leave(created.groupId)}
            // The sheet has to keep naming itself, and this view's own title
            // is the only sensible name for it.
            heading={SheetTitle}
          />
        ) : view === "icon" ? (
          <GroupIconPicker
            name={name}
            onName={setName}
            icon={icon}
            color={color}
            onIcon={setIcon}
            onColor={setColor}
            onBack={() => setView("form")}
          />
        ) : (
          // The same sheet, showing the list instead of the form. Not a second
          // sheet over the first: the currency is a field of this form, and
          // stacking a modal on a modal to edit one is how a phone runs out of
          // room to close things.
          <CurrencyPicker
            value={currency}
            // Mirrors the row that opened it, which is now reachable from one
            // mode only and so says one thing.
            title={t("balanceCurrency")}
            onSelect={(code) => {
              setCurrency(code);
              setView("form");
            }}
            onBack={() => setView("form")}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

/** The icon, the name, and the description that is not asked for yet. */
function IdentityRow({
  nameId,
  name,
  onName,
  icon,
  color,
  onOpenIcons,
  descOpen,
  description,
  onDescription,
  onOpenDescription,
}: {
  nameId: string;
  name: string;
  onName: (value: string) => void;
  icon: GroupIcon | null;
  color: GroupIconColor;
  onOpenIcons: () => void;
  descOpen: boolean;
  description: string;
  onDescription: (value: string) => void;
  onOpenDescription: () => void;
}) {
  const t = useTranslations("groupForm");

  return (
    <div className="flex flex-col gap-2.5 pt-1">
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={onOpenIcons}
          aria-label={t("chooseIcon")}
          className="relative flex size-13 shrink-0 items-center justify-center rounded-2xl transition-colors duration-150"
        >
          {icon ? (
            <GroupIconTile
              icon={icon}
              color={color}
              className="size-13 rounded-2xl"
            />
          ) : (
            <span className="flex size-13 items-center justify-center rounded-2xl bg-wash-2 text-muted-foreground inset-ring inset-ring-foreground/14">
              <Plus aria-hidden="true" className="size-6" />
            </span>
          )}
          {/* The badge says the tile opens something, and leaves once it has. */}
          <span
            aria-hidden="true"
            className={cn(
              "absolute -right-1 -bottom-1 flex size-[18px] items-center justify-center rounded-full bg-card text-foreground inset-ring inset-ring-foreground/18 transition-opacity duration-150",
              icon ? "opacity-0" : "opacity-100",
            )}
          >
            <Plus className="size-2.5" />
          </span>
        </button>

        <Input
          id={nameId}
          name="name"
          value={name}
          onChange={(event) => onName(event.target.value)}
          required
          maxLength={120}
          autoComplete="off"
          placeholder={t("name")}
          className="h-13 flex-1 rounded-[14px] border-0 bg-wash-2 px-4 text-base font-medium tracking-[-0.01em] inset-ring inset-ring-foreground/12 focus-visible:bg-wash-2 focus-visible:ring-[3px] focus-visible:ring-primary/28 focus-visible:inset-ring-primary"
        />
      </div>

      {descOpen ? (
        <Textarea
          name="description"
          value={description}
          onChange={(event) => onDescription(event.target.value)}
          maxLength={2000}
          autoFocus
          placeholder={t("descriptionOptional")}
          className="min-h-17 resize-none rounded-[14px] border-0 bg-wash-2 px-4 py-3 text-base inset-ring inset-ring-foreground/12 focus-visible:bg-wash-2 focus-visible:ring-[3px] focus-visible:ring-primary/28 focus-visible:inset-ring-primary md:text-sm"
        />
      ) : (
        <button
          type="button"
          onClick={onOpenDescription}
          className="tap-target h-7 self-start rounded-full px-2.5 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-wash-2"
        >
          + {t("addDescription")}
        </button>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-semibold tracking-[0.07em] text-muted-foreground uppercase">
      {children}
    </span>
  );
}

/** Who is in the group, as a list you can see rather than a count. */
function Participants({
  members,
  draft,
  draftRef,
  onDraft,
  onAdd,
  onRemove,
}: {
  members: Member[];
  draft: string;
  draftRef: React.RefObject<HTMLInputElement | null>;
  onDraft: (value: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  const t = useTranslations("groupForm");

  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <SectionLabel>{t("participants")}</SectionLabel>
        <span className="text-xs text-muted-foreground/85 tabular-nums">
          {t("participantCount", { count: members.length })}
        </span>
      </div>

      <ul className="flex flex-col gap-1.5">
        {members.map((member, index) => (
          // Names repeat, so position is the only identity a row has.
          <li
            key={`${member.name}-${index}`}
            className="flex h-12 items-center gap-2.5 rounded-[14px] bg-wash-1 pr-2 pl-2.5 inset-ring inset-ring-foreground/7"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-2xs font-semibold text-accent-foreground">
              {member.name.trim().slice(0, 1).toUpperCase()}
            </span>
            <span className="flex-1 truncate text-sm font-medium">
              {member.name}
            </span>
            {member.you && (
              <span className="flex h-5 shrink-0 items-center rounded-full bg-primary/16 px-2 text-2xs font-semibold text-primary-ink">
                {t("you")}
              </span>
            )}
            <button
              type="button"
              onClick={() => onRemove(index)}
              // The creator's own row keeps the space so the list stays
              // aligned, but there is nothing there to press.
              className={cn(
                "tap-target flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150",
                member.you
                  ? "pointer-events-none opacity-0"
                  : "hover:bg-wash-3 hover:text-foreground",
              )}
              tabIndex={member.you ? -1 : undefined}
              aria-hidden={member.you}
            >
              <X aria-hidden="true" className="size-[15px]" />
              <span className="sr-only">
                {t("removePerson", { name: member.name })}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className="flex h-12 items-center gap-2.5 rounded-[14px] pr-2 pl-2.5 inset-ring inset-ring-foreground/12">
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground inset-ring inset-ring-foreground/18"
        >
          <Plus className="size-3.5" />
        </span>
        <input
          ref={draftRef}
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter adds a person. It must not submit the whole form.
            if (event.key === "Enter") {
              event.preventDefault();
              onAdd();
            }
          }}
          maxLength={120}
          autoComplete="off"
          aria-label={t("addPerson")}
          placeholder={t("addPerson")}
          className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"
        />
        <button
          type="button"
          onClick={onAdd}
          disabled={draft.trim() === ""}
          className={cn(
            "tap-target flex h-8 shrink-0 items-center rounded-full bg-wash-3 px-3 text-xs font-semibold transition-opacity duration-150",
            draft.trim() === "" ? "opacity-35" : "opacity-100",
          )}
        >
          {t("add")}
        </button>
      </div>

      <p className="text-xs text-muted-foreground/90">
        {t("participantsHelp")}
      </p>
    </section>
  );
}

/**
 * The one question left at creation, and the answer that needs a currency.
 *
 * Everything else on this sheet can be changed afterwards; this cannot
 * (`settingsPage.currencyModeFixed`), and it decides what every amount the
 * group ever records means. So it stays — reduced to the thing a reader has to
 * decide, which is what happens when somebody pays in another currency.
 *
 * The two paragraphs that used to explain it are gone. They described the
 * mechanism — a rate frozen on the day, a balance per currency — to somebody
 * who has not recorded an expense yet and cannot picture either. A line each
 * says the outcome instead, and the group's settings say the rest once there
 * is a group to say it about.
 */
function CurrencyQuestion({
  mode,
  onMode,
  currency,
  onOpenCurrency,
}: {
  mode: CurrencyMode;
  onMode: (mode: CurrencyMode) => void;
  currency: string;
  onOpenCurrency: () => void;
}) {
  const t = useTranslations("groupForm");

  const options = [
    {
      value: "converted" as const,
      title: t("modeConvertedTitle"),
      subtitle: t("modeConvertedSubtitle", { currency }),
    },
    {
      value: "separate" as const,
      title: t("modeSeparateTitle"),
      subtitle: t("modeSeparateSubtitle"),
    },
  ];

  return (
    <section className="flex flex-col gap-1.5">
      <SectionLabel>{t("foreignCurrencyQuestion")}</SectionLabel>

      <div role="radiogroup" className="flex flex-col gap-1.5">
        {options.map((option) => {
          const selected = mode === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onMode(option.value)}
              className={cn(
                "flex h-14 items-center gap-3 rounded-[14px] px-3 text-left transition-colors duration-150",
                selected
                  ? "bg-primary/12 inset-ring inset-ring-primary/45"
                  : "bg-wash-1 inset-ring inset-ring-foreground/7",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-4.5 shrink-0 items-center justify-center rounded-full transition-colors duration-150",
                  selected
                    ? "inset-ring inset-ring-primary"
                    : "inset-ring inset-ring-foreground/28",
                )}
              >
                <span
                  className={cn(
                    "size-2 rounded-full bg-primary transition-transform duration-150",
                    selected ? "scale-100" : "scale-0",
                  )}
                />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-semibold">{option.title}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {option.subtitle}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/*
       * The base currency, asked under the converted answer and nowhere else.
       * A separate group has no base currency — `createGroup` stores null and
       * every balance reader gates on the mode — so asking for one in that
       * mode collected a value the group would not keep. Worse, a value it did
       * keep would outrank the group's own habit in `defaultCurrency()` and
       * open the entry drawer on a currency nobody in the group had used.
       */}
      {mode === "converted" && (
        <CurrencyRow
          value={currency}
          label={t("balanceCurrencyLabel")}
          onOpen={onOpenCurrency}
        />
      )}

      <p className="mt-0.5 flex items-start gap-1.5 text-xs text-pretty text-muted-foreground">
        <Lock aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
        {t("modeFixedShort")}
      </p>
    </section>
  );
}

/**
 * The currency, as one row that opens the list.
 *
 * It replaced four chips and an overflow arrow. Four was never the number:
 * whichever four were picked, a fifth of the people opening this sheet were
 * looking for the fifth, and for them the row of chips was a row of wrong
 * answers to tap past. One row that says what is chosen and opens a search is
 * the same tap for everybody.
 *
 * Indented past the radio dot above it, so that it reads as part of the answer
 * it belongs to rather than as a fourth question.
 */
function CurrencyRow({
  value,
  label,
  onOpen,
}: {
  value: string;
  label: string;
  onOpen: () => void;
}) {
  const locale = useLocale();
  const entry = currencyEntry(value, locale);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="ml-[30px] flex h-12 items-center gap-2.5 rounded-[14px] px-3.5 text-left inset-ring inset-ring-foreground/12 transition-colors duration-150 hover:bg-wash-1"
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="flex flex-1 items-center justify-end gap-1.5 text-sm font-semibold">
        <span aria-hidden="true" className="text-base leading-none">
          {entry?.flag}
        </span>
        {value}
        <ChevronRight aria-hidden="true" className="size-3.5 opacity-45" />
      </span>
    </button>
  );
}
