"use client";

import { useTranslations } from "next-intl";
import {
  CopyButton,
  ShareButton,
  displayUrl,
  useCanShare,
} from "@/components/groups/invite-link-controls";

/** The chip the link is read in, whatever button ends up sitting inside it. */
function Chip({ url, children }: { url: string; children: React.ReactNode }) {
  return (
    <span className="flex h-11 min-w-0 flex-1 items-center gap-1.5 rounded-xl bg-muted pr-1 pl-3">
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {displayUrl(url)}
      </span>
      {/*
        Inset in the chip rather than beside it: the button and the thing it
        copies are one object, and pulling them apart cost the URL a third of
        its width on a phone.
      */}
      {children}
    </span>
  );
}

/** What the copy button looks like once it is inside the chip. */
const INSET =
  "shrink-0 rounded-[9px] bg-card text-foreground shadow-hairline hover:bg-card";

/**
 * The group's guest link on the overview of a group with nothing in it yet,
 * as one row that both shows the link and sends it.
 *
 * This used to be a paragraph saying to go to the People tab and make a link.
 * The link already exists — the group was minted with one — so the paragraph
 * was directions to something that was already in the reader's hand.
 *
 * The only reason this is a client island inside an otherwise server-rendered
 * card is `useCanShare`: the row has two shapes and the browser picks. Where
 * there is a share sheet the chip keeps the link and the button beside it
 * hands it over; where there is not, that button would open nothing, so it
 * goes and the chip's own copy button says "Copy" out loud instead. Never
 * both — two ways to copy one link reads as two different links.
 */
export function GuestLinkRow({
  url,
  groupName,
}: {
  url: string;
  groupName: string;
}) {
  const t = useTranslations("inviteLink");
  // Null is "not known yet", and every caller reads it as "assume it can" —
  // see `useCanShare`. Only a browser that has actually said no loses the
  // share button.
  const shares = useCanShare() !== false;

  return (
    <div className="flex items-center gap-2">
      <Chip url={url}>
        {shares ? (
          // Named in full where the name is only ever heard: "Copy" beside a
          // URL is obvious to look at and ambiguous to listen to.
          <CopyButton
            url={url}
            variant="ghost"
            iconOnly
            label={t("copyTheLink")}
            className={INSET}
          />
        ) : (
          <CopyButton
            url={url}
            variant="ghost"
            className={`h-9 px-3 font-semibold md:h-9 ${INSET}`}
          />
        )}
      </Chip>
      {shares && (
        <ShareButton
          url={url}
          groupName={groupName}
          variant="secondary"
          className="h-11 shrink-0 rounded-xl px-4 text-sm font-semibold"
        />
      )}
    </div>
  );
}
