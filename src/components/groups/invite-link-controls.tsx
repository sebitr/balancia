"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, ChevronRight, Clock, Copy, Share } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setJoinLinkExpiryAction } from "@/modules/join/actions";
import {
  JOIN_LINK_EXPIRY_CHOICES,
  expiryDate,
  isExpiryChoice,
  remainingFor,
  type JoinLinkExpiryChoice,
} from "@/modules/join/expiry";
import { cn } from "@/lib/utils";

/**
 * The parts both invite-link screens are made of.
 *
 * The card in settings and the screen after "Create group" show the same
 * object, so they share the pieces rather than each drawing their own: a
 * reader who copies the link on one and revokes it on the other should never
 * be able to tell they were looking at two components.
 */

/** How long "Copied" stays before the button says "Copy" again. */
const COPIED_MS = 1600;

/**
 * Copying, and the moment of feedback that says it worked.
 *
 * The timer is cleared on unmount, because the sheet this can live inside
 * closes while it is still running.
 */
export function useCopy(): {
  copied: boolean;
  copy: (value: string) => Promise<void>;
} {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(async (value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  }, []);

  return { copied, copy };
}

/**
 * Whether this browser can hand the link to another app.
 *
 * Null through the server render and the hydration that has to match it,
 * because there is no `navigator` on the server to ask. Null therefore means
 * "not known yet", and every caller reads it as "assume it can": promising a
 * share sheet and falling back to the clipboard is a smaller wrong than
 * hiding the share button on the phones where sharing is the whole point.
 *
 * Read as an external store rather than in an effect, so the answer arrives
 * with the first post-hydration render instead of one render after it.
 */
const NO_UPDATES = () => () => {};

export function useCanShare(): boolean | null {
  return useSyncExternalStore<boolean | null>(
    NO_UPDATES,
    () => "share" in navigator,
    () => null,
  );
}

/**
 * Opens the native share sheet, which is what puts the group's chat app first.
 *
 * A dismissed sheet rejects, and that is not a failure worth a toast — the
 * reader closed it on purpose. Anything else falls back to the clipboard,
 * which is the same outcome by a slower route.
 */
export async function shareOrCopy(
  payload: { title: string; text: string; url: string },
  fallback: (value: string) => Promise<void>,
): Promise<void> {
  if (typeof navigator !== "undefined" && "share" in navigator) {
    try {
      await navigator.share(payload);
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }
  await fallback(payload.url);
}

/** The URL as it is read rather than as it is sent: no scheme, one line. */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

/** The link itself, in a shape that survives being long. */
export function LinkChip({
  url,
  spent = false,
  className,
}: {
  url: string;
  /** Revoked or expired: still shown, visibly no longer a way in. */
  spent?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "min-w-0 truncate rounded-lg bg-muted px-3 py-2.5 font-mono text-2xs text-secondary-foreground",
        spent && "text-muted-foreground line-through",
        className,
      )}
    >
      {displayUrl(url)}
    </span>
  );
}

/** Copy, and the check that replaces it for a second and a half. */
export function CopyButton({
  url,
  variant = "outline",
  className,
  label,
  iconOnly = false,
}: {
  url: string;
  variant?: "outline" | "default" | "ghost";
  className?: string;
  /** Overrides "Copy" where the button is the screen's main action. */
  label?: string;
  /**
   * Just the glyph, for the one place the button sits inside the chip it
   * copies. The word would be a second name for something the chip beside it
   * has already named, and there is no room for it; the label moves to
   * `aria-label`, where it still says which link is being copied — and still
   * turns into "Copied", because a check mark on its own is not an
   * announcement.
   */
  iconOnly?: boolean;
}) {
  const t = useTranslations("inviteLink");
  const { copied, copy } = useCopy();
  const name = copied ? t("copied") : (label ?? t("copy"));

  return (
    <Button
      type="button"
      variant={variant}
      size={iconOnly ? "icon-lg" : "default"}
      aria-label={iconOnly ? name : undefined}
      className={cn(!iconOnly && "h-10", className)}
      onClick={() => void copy(url)}
    >
      {copied ? (
        <Check aria-hidden="true" className="text-positive-ink" />
      ) : (
        <Copy aria-hidden="true" />
      )}
      {!iconOnly && name}
    </Button>
  );
}

/** Share, for the browsers that have somewhere to share to. */
export function ShareButton({
  url,
  groupName,
  variant = "default",
  className,
  children,
}: {
  url: string;
  groupName: string;
  /**
   * Secondary where the link is one row of a card rather than the screen's
   * own last step, so the primary fill stays with whatever that screen is
   * actually for.
   */
  variant?: "default" | "secondary";
  className?: string;
  children?: React.ReactNode;
}) {
  const t = useTranslations("inviteLink");
  const { copied, copy } = useCopy();

  return (
    <Button
      type="button"
      variant={variant}
      className={cn("h-10", className)}
      onClick={() =>
        void shareOrCopy(
          {
            title: t("shareTitle", { group: groupName }),
            text: t("shareText", { group: groupName }),
            url,
          },
          copy,
        )
      }
    >
      {/*
        A browser that turned out to have no share sheet gets the clipboard
        instead, and has to be told so: a share button that silently copies is
        a button that did nothing, as far as the reader can see.
      */}
      {copied ? (
        <Check aria-hidden="true" className="text-positive-ink" />
      ) : (
        <Share aria-hidden="true" />
      )}
      {copied ? t("copied") : (children ?? t("share"))}
    </Button>
  );
}

/**
 * When the link stops working, as a row that opens four choices.
 *
 * The row says how long is actually left rather than which option was picked,
 * because a week-long link is four days old by Thursday, and "In 7 days" then
 * would be a lie about the only thing this row exists to say.
 *
 * The change is optimistic: the date is the reader's own decision and the
 * server has no opinion to wait for. A failure puts the old one back and says
 * so, which is the only case where the row moves twice.
 */
export function ExpiryRow({
  groupId,
  label,
  expiresAt,
  now,
  disabled = false,
  onChange,
}: {
  groupId: string;
  label: string;
  /** ISO instant, or null when the link never lapses. */
  expiresAt: string | null;
  /**
   * When the server drew this. "In 6 days" is a subtraction, and doing it
   * against two different clocks either side of hydration is how a row
   * re-renders into a different sentence than the one already on screen.
   */
  now: string;
  disabled?: boolean;
  /**
   * Told when the reader moves the value, for a caller that says something
   * about it elsewhere on the screen.
   *
   * The date and the clock it was set against travel together, because either
   * on its own is half a subtraction. Only the reader's own changes are
   * reported: a new `expiresAt` prop is the caller's own news arriving back,
   * and firing on that would be this row telling it what it just said.
   */
  onChange?: (expiresAt: string | null, now: number) => void;
}) {
  const t = useTranslations("inviteLink");
  const router = useRouter();
  const [value, setValue] = useState(expiresAt);
  // Only moves when the reader changes something, at which point the browser's
  // own clock is the right one and there is no server render left to match.
  const [at, setAt] = useState(() => Date.parse(now));
  const [pending, setPending] = useState(false);

  /*
   * The server is the truth, and a refresh moves it underneath the optimistic
   * value shown here. Adjusted during the render that brings the new prop
   * rather than in an effect, so the row never paints the stale date first.
   *
   * The clock moves with it. A date from the server measured against a clock
   * frozen when the reader tapped is a subtraction across two instants that
   * are not the same one, and the rounding below turns any overshoot into a
   * whole extra hour: pick "In 24 hours", wait for the round trip, read 25.
   */
  const [rendered, setRendered] = useState(expiresAt);
  if (rendered !== expiresAt) {
    setRendered(expiresAt);
    setValue(expiresAt);
    setAt(Date.parse(now));
  }

  const choose = async (choice: JoinLinkExpiryChoice) => {
    const previous = { value, at };
    // One instant, read once: the optimistic date and the clock it will be
    // measured against have to be the same "now", or "In 24 hours" rounds up
    // to 25 the moment they are a millisecond apart.
    const chosenAt = Date.now();
    const chosen =
      expiryDate(choice, new Date(chosenAt))?.toISOString() ?? null;
    setValue(chosen);
    setAt(chosenAt);
    onChange?.(chosen, chosenAt);
    setPending(true);
    try {
      const result = await setJoinLinkExpiryAction(groupId, choice);
      if (!result.ok) {
        setValue(previous.value);
        setAt(previous.at);
        onChange?.(previous.value, previous.at);
        toast.error(result.error ?? t("expiryFailed"));
        return;
      }
      // The server's own date arrives with the refresh, paired with the
      // instant it was drawn at. Taking it from the action instead would pin a
      // server date to this browser's clock — the same mismatch again.
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled || pending}
          className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-colors duration-150 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
        >
          <Clock
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
          />
          <span className="min-w-0 flex-1 text-sm">{label}</span>
          <span className="text-sm font-medium">
            <RemainingLabel expiresAt={value} now={at} />
          </span>
          <ChevronRight
            aria-hidden="true"
            className="size-3.5 shrink-0 text-muted-foreground"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {/*
          Only "Never" can be checked. The other three are durations measured
          from the moment they are picked, and a stored date stops being any of
          them the next day — marking one would tell the reader their week-old
          link expires in a week.
        */}
        <DropdownMenuRadioGroup
          value={value === null ? "never" : ""}
          onValueChange={(next) => {
            if (isExpiryChoice(next)) void choose(next);
          }}
        >
          {JOIN_LINK_EXPIRY_CHOICES.map((choice) => (
            <DropdownMenuRadioItem key={choice} value={choice}>
              {t(`expiryChoice.${choice}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** "In 6 days", "In 3 hours", "Never" — whichever the date actually is. */
export function RemainingLabel({
  expiresAt,
  now,
}: {
  expiresAt: string | null;
  /** Epoch milliseconds. See `ExpiryRow` for why this is passed in. */
  now: number;
}) {
  const t = useTranslations("inviteLink");
  const remaining = remainingFor(
    expiresAt ? new Date(expiresAt) : null,
    new Date(now),
  );

  switch (remaining.kind) {
    case "never":
      return t("expiryChoice.never");
    case "expired":
      return t("expiredValue");
    case "hours":
      return t("inHours", { count: remaining.count });
    case "days":
      return t("inDays", { count: remaining.count });
  }
}
