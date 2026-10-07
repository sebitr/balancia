"use client";

import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { WifiOff } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  ENTRY_DESK,
  ENTRY_SHEET_CLASS,
  EntryFormSkeleton,
  openOnAmount,
} from "@/components/entries/entry-sheet";
import { loadSnapshot, type GroupSnapshot } from "@/lib/offline/snapshot";
import type { DeviceActor } from "@/lib/offline/owner";
import { DeviceActorProvider } from "./device-actor";

/**
 * The add-entry drawer, opened without going anywhere.
 *
 * Everywhere else in the app, adding an entry is a route: `/expenses/new`,
 * intercepted so it opens over the group. That is the right shape and it stays
 * the shape — right up until the network goes, at which point a route is a
 * request to a server that is not answering, and the reader gets the offline
 * screen instead of a form.
 *
 * So this is the same drawer with the navigation taken out. It renders from
 * the snapshot on the device (see `snapshot.ts`), which means it can open with
 * the radio off, and it is only ever reached when the browser says there is no
 * network — the routed drawer is better in every other case, because it knows
 * the group's live balances and this one cannot.
 */

interface OfflineEntry {
  /** Opens the local drawer. Safe to call when there is no snapshot. */
  readonly open: () => void;
}

/**
 * The form, fetched the first time this drawer shows it rather than with the
 * group.
 *
 * This provider wraps every group screen, and the form is the largest thing in
 * the app: the receipt scanner and its camera, the category catalogue, the
 * split and recurrence sheets. Imported at the top of this file, all of it was
 * in the code the first group screen an invited guest opens had to download
 * and parse on a phone — for a drawer that only ever opens after a tap, with
 * no network. The routed drawer needs none of this: it is a route of its own,
 * and its code arrives when it is navigated to.
 *
 * Lazy is safe offline because the service worker precaches every build chunk
 * under `maximumFileSizeToCacheInBytes` in `serwist.config.mjs`, this one
 * included, so a device that has opened the group once already holds it. The
 * build names any chunk that grows past that line.
 */
const AddEntryForm = lazy(() =>
  import("@/components/entries/add-entry-form").then((module) => ({
    default: module.AddEntryForm,
  })),
);

const OfflineEntryContext = createContext<OfflineEntry | null>(null);

/**
 * How the bottom bar's "Add" reaches this drawer.
 *
 * Null outside a group, which is correct rather than an oversight: there is no
 * one group to add to from the home screen, and a caller that finds null
 * should leave its link alone.
 */
export function useOfflineEntry(): OfflineEntry | null {
  return useContext(OfflineEntryContext);
}

/**
 * The group's offline context: the local drawer, and who is using it.
 *
 * The second half is `DeviceActorProvider`, mounted here because this is
 * already the one provider that wraps everything in a group that touches the
 * device's store — the pending strip, the flush, the routed drawer and this
 * sheet — and a second wrapper in the layout would say the same thing twice.
 */
export function OfflineEntryProvider({
  groupId,
  userId,
  participantId,
  children,
}: DeviceActor & { children: ReactNode }) {
  const [showing, setShowing] = useState(false);
  const open = useCallback(() => setShowing(true), []);

  return (
    <DeviceActorProvider
      userId={userId}
      groupId={groupId}
      participantId={participantId}
    >
      <OfflineEntryContext.Provider value={{ open }}>
        {children}
        {showing && (
          <OfflineEntrySheet
            groupId={groupId}
            onClose={() => setShowing(false)}
          />
        )}
      </OfflineEntryContext.Provider>
    </DeviceActorProvider>
  );
}

/**
 * The sheet, mounted only once somebody has asked for it — so the snapshot is
 * read from the device when the drawer opens rather than on every group page.
 */
function OfflineEntrySheet({
  groupId,
  onClose,
}: {
  groupId: string;
  onClose: () => void;
}) {
  const [snapshot, setSnapshot] = useState<GroupSnapshot | null | "loading">(
    "loading",
  );

  useEffect(() => {
    let live = true;
    void loadSnapshot(groupId).then((found) => {
      if (live) setSnapshot(found);
    });
    return () => {
      live = false;
    };
  }, [groupId]);

  return (
    <Sheet open onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        desk={ENTRY_DESK}
        className={ENTRY_SHEET_CLASS}
        onOpenAutoFocus={openOnAmount}
      >
        {snapshot === "loading" ? null : snapshot ? (
          <Suspense fallback={<FormArriving />}>
            <OfflineEntryForm snapshot={snapshot} onClose={onClose} />
          </Suspense>
        ) : (
          <NothingSaved />
        )}
      </SheetContent>
    </Sheet>
  );
}

function OfflineEntryForm({
  snapshot,
  onClose,
}: {
  snapshot: GroupSnapshot;
  onClose: () => void;
}) {
  return (
    <AddEntryForm
      groupId={snapshot.groupId}
      groupName={snapshot.groupName}
      members={snapshot.members}
      selfId={snapshot.selfId}
      currencyMode={snapshot.currencyMode}
      baseCurrency={snapshot.baseCurrency}
      defaultCurrency={snapshot.defaultCurrency}
      timezone={snapshot.timezone}
      /*
       * No repayments here, and no empty settle tab pretending otherwise.
       *
       * Settling needs to know who owes whom, which is a balance — the one
       * thing a snapshot deliberately does not keep, because a balance from
       * this morning is a wrong number rather than an old one. An expense is
       * a fact about a receipt in somebody's pocket and needs no server to be
       * true; a debt is a running total and does.
       */
      entryTypes={["expense", "income"]}
      outstanding={[]}
      frequentCategories={snapshot.frequentCategories}
      /*
       * Both readers are off. The server-side one is a network call by
       * definition; the on-device one would work, but its models are tens of
       * megabytes fetched on first use and there is no fetching anything here.
       * A scan button that can only fail is worse than no scan button.
       */
      receiptScanning={false}
      onClose={onClose}
      onSaved={onClose}
    />
  );
}

/**
 * The form's outline while its code is read from the device — the same
 * skeleton the routed drawer shows while the server answers, so the two
 * drawers arrive the same way.
 */
function FormArriving() {
  const t = useTranslations("common");

  return (
    <div
      role="status"
      aria-label={t("loading")}
      className="flex flex-col gap-5 px-4 pt-6"
    >
      <EntryFormSkeleton />
    </div>
  );
}

/**
 * A group this device has never held the form for.
 *
 * Reachable, and worth saying plainly: the reader tapped Add and something has
 * to answer. The snapshot is written when the add-entry screen opens with a
 * network, so the fix is genuinely "open this once before you travel", which
 * is what this says.
 */
function NothingSaved() {
  const t = useTranslations("outbox");

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <WifiOff aria-hidden="true" className="size-6" />
      </span>
      <h2 className="font-heading text-lg font-semibold">
        {t("notSavedTitle")}
      </h2>
      <p className="text-sm text-pretty text-muted-foreground">
        {t("notSavedBody")}
      </p>
    </div>
  );
}
