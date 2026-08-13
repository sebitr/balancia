import Link from "next/link";
import { getTranslations } from "next-intl/server";
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
  const t = await getTranslations("settingsPage");

  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-semibold tracking-tight">
        {t("title")}
      </h1>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("shortcuts")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/groups/${groupId}/recurring`}>
              <RefreshCw aria-hidden="true" />
              {t("recurring")}
            </Link>
          </Button>
          {access.permissions.importData && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/groups/${groupId}/import`}>
                <Download aria-hidden="true" />
                {t("import")}
              </Link>
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("currencies")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>
            {access.group.currencyMode === "converted"
              ? t("convertedNote", {
                  currency: access.group.baseCurrency ?? "",
                })
              : t("separateNote")}
          </p>
          <p className="text-xs text-muted-foreground">{t("modeFixed")}</p>
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
        <p className="text-sm text-muted-foreground">{t("ownerOnly")}</p>
      )}
    </div>
  );
}
