import Link from "next/link";
import { Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GroupSettingsForm } from "@/components/groups/group-settings-form";
import { DangerZone } from "@/components/groups/danger-zone";
import { requireGroupAccess } from "@/lib/actions";

export default async function GroupSettingsPage({
  params,
}: PageProps<"/groups/[groupId]/settings">) {
  const { groupId } = await params;
  const access = await requireGroupAccess(groupId);

  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-semibold tracking-tight">
        Group settings
      </h1>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Shortcuts</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/groups/${groupId}/recurring`}>
              <RefreshCw aria-hidden="true" />
              Recurring expenses
            </Link>
          </Button>
          {access.permissions.importData && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/groups/${groupId}/import`}>
                <Download aria-hidden="true" />
                Import from Splitwise
              </Link>
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Currencies</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>
            {access.group.currencyMode === "converted"
              ? `Everything is converted into ${access.group.baseCurrency} at the rate recorded with each expense.`
              : "Each currency keeps its own balance. Nothing is converted."}
          </p>
          <p className="text-xs text-muted-foreground">
            The currency mode is fixed once a group exists — changing it would
            reinterpret every amount already recorded.
          </p>
        </CardContent>
      </Card>

      {access.permissions.manageGroupSettings ? (
        <>
          <GroupSettingsForm
            groupId={access.groupId}
            name={access.group.name}
            timezone={access.group.timezone}
          />
          <DangerZone
            groupId={access.groupId}
            groupName={access.group.name}
            archived={access.group.archivedAt !== null}
          />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Only the group owner can change these settings.
        </p>
      )}
    </div>
  );
}
