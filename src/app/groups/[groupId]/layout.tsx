import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { GroupNav } from "@/components/layout/group-nav";
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
  params,
}: LayoutProps<"/groups/[groupId]">) {
  const { groupId } = await params;
  const access = await resolveAccess(groupId);

  return (
    <AppShell
      actor={{
        label:
          access.actor.kind === "guest"
            ? access.actor.displayName
            : access.actor.name,
        email: access.actor.kind === "user" ? access.actor.email : undefined,
        isGuest: access.actor.kind === "guest",
      }}
      bottomNav={<GroupNav groupId={access.groupId} />}
    >
      {children}
    </AppShell>
  );
}
