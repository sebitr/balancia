import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { GroupNav } from "@/components/layout/group-nav";
import { GroupSwitcher } from "@/components/layout/group-switcher";
import { OfflineEntryProvider } from "@/components/offline/offline-entry";
import { OutboxFlusher } from "@/components/offline/outbox-flusher";
import { PendingStrip } from "@/components/offline/pending-strip";
import { getCurrentActor } from "@/lib/security/actor";
import {
  AuthenticationRequiredError,
  AuthorizationError,
  authorizeGroup,
  type GroupAccess,
} from "@/lib/security/authorization";

/**
 * Group shell.
 *
 * Authorization happens here, once, before any child page loads data. Members
 * and guests both land here; the difference is what `authorizeGroup` grants
 * them, not which layout they get.
 *
 * The authorization call is isolated in its own function so the try/catch does
 * not wrap any JSX — a rejected render inside a catch would swallow errors
 * from the children too.
 */
async function resolveAccess(groupId: string): Promise<GroupAccess> {
  const actor = await getCurrentActor();
  try {
    return await authorizeGroup(actor, groupId);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      redirect(`/sign-in?next=/groups/${groupId}`);
    }
    if (error instanceof AuthorizationError) {
      // Deliberately indistinguishable from "no such group": whether a group
      // exists is not something an outsider should be able to probe.
      notFound();
    }
    throw error;
  }
}

export default async function GroupLayout({
  children,
  entry,
  params,
}: LayoutProps<"/groups/[groupId]">) {
  const { groupId } = await params;
  const access = await resolveAccess(groupId);

  return (
    /*
     * Wrapping the shell rather than sitting inside it, so that the bottom
     * bar is under the provider too. `bottomNav` is an element created here
     * and rendered by `AppShell`, and context follows where a thing is
     * rendered — which is what lets the bar's "Add" open the local drawer
     * when a routed one could not load.
     */
    <OfflineEntryProvider groupId={access.groupId}>
      <AppShell
        actor={{
          label:
            access.actor.kind === "guest"
              ? access.actor.displayName
              : access.actor.name,
          isGuest: access.actor.kind === "guest",
        }}
        bottomNav={<GroupNav groupId={access.groupId} />}
        // The name is already resolved by the authorization above, so the header
        // costs no query of its own; the switcher asks for the rest on opening.
        leading={
          <GroupSwitcher
            groupId={access.groupId}
            groupName={access.group.name}
            isGuest={access.actor.kind === "guest"}
          />
        }
      >
        {/* What has not reached the server yet, above whatever screen of the
          group is showing — including the balances it is not in. It renders
          nothing at all with an empty queue and a network. */}
        <div className="mb-4 empty:mb-0">
          <PendingStrip groupId={access.groupId} />
        </div>
        {children}
        {/* The add-entry drawer, when a navigation into it was intercepted. It
          lives beside the group rather than inside it so that opening it
          leaves the screen underneath mounted, scrolled where it was. */}
        {entry}
        {/* Drains the offline queue whenever there is reason to think it can
          be drained. Mounted in the group shell rather than the root layout
          because a group is the only place entries are queued from, and the
          only place the refresh it triggers has anything to refresh. */}
        <OutboxFlusher />
      </AppShell>
    </OfflineEntryProvider>
  );
}
