import { Badge } from "@/components/ui/badge";
import { AddParticipantForm } from "@/components/members/add-participant-form";
import { InvitationControls } from "@/components/members/invitation-controls";
import { RemoveParticipantButton } from "@/components/members/remove-participant-button";
import { requireGroupAccess } from "@/lib/actions";
import { listParticipants } from "@/modules/groups/service";

export default async function MembersPage({
  params,
}: PageProps<"/groups/[groupId]/members">) {
  const { groupId } = await params;
  const access = await requireGroupAccess(groupId);
  const participants = await listParticipants(access.groupId);

  const canManage = access.permissions.manageParticipants;
  const canInvite = access.permissions.manageInvitations;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          People
        </h1>
        <p className="text-sm text-muted-foreground">
          Everyone who shares expenses in this group.
        </p>
      </div>

      <ul className="divide-y rounded-lg border">
        {participants.map((participant) => (
          <li key={participant.id} className="space-y-3 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  <span className="truncate">{participant.displayName}</span>
                  {participant.role === "owner" && (
                    <Badge variant="secondary">Owner</Badge>
                  )}
                  {participant.role === "guest" && (
                    <Badge variant="outline">No account</Badge>
                  )}
                </p>
                {participant.email && (
                  <p className="truncate text-sm text-muted-foreground">
                    {participant.email}
                  </p>
                )}
              </div>
              {canManage && participant.role !== "owner" && (
                <RemoveParticipantButton
                  groupId={groupId}
                  participantId={participant.id}
                  displayName={participant.displayName}
                />
              )}
            </div>

            {canInvite && participant.role === "guest" && (
              <InvitationControls
                groupId={groupId}
                participantId={participant.id}
                displayName={participant.displayName}
                hasActiveInvitation={participant.hasActiveInvitation}
                invitationPrefix={participant.invitationPrefix}
                expiresAt={
                  participant.invitationExpiresAt?.toISOString() ?? null
                }
                lastUsedAt={
                  participant.invitationLastUsedAt?.toISOString() ?? null
                }
              />
            )}
          </li>
        ))}
      </ul>

      {canManage && <AddParticipantForm groupId={groupId} />}
    </div>
  );
}
