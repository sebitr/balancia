import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FileJson, RefreshCw, Sheet, Table, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GroupSettingsForm } from "@/components/groups/group-settings-form";
import { DangerZone } from "@/components/groups/danger-zone";
import { requireGroupAccess } from "@/lib/actions";
import { PUSH } from "@/components/motion/transitions";

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
        <CardContent className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button asChild variant="outline" size="sm">
            <Link href={`/groups/${groupId}/recurring`} transitionTypes={PUSH}>
              <RefreshCw aria-hidden="true" />
              {t("recurring")}
            </Link>
          </Button>
          {access.permissions.importData && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/groups/${groupId}/import`} transitionTypes={PUSH}>
                <Upload aria-hidden="true" />
                {t("import")}
              </Link>
            </Button>
          )}
        </CardContent>
      </Card>

      {access.permissions.exportData && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Export</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Your data, in a format you can open anywhere. The file is built on
              this server and sent straight to you.
            </p>
            {/* Stacked on a phone, side by side once there is room. `download`
                plus a plain anchor keeps this working without JavaScript. */}
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Button asChild variant="outline" size="sm">
                <a href={`/api/groups/${groupId}/export?format=csv`} download>
                  <Table aria-hidden="true" />
                  CSV
                </a>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href={`/api/groups/${groupId}/export?format=xlsx`} download>
                  <Sheet aria-hidden="true" />
                  Excel
                </a>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href={`/api/groups/${groupId}/export?format=json`} download>
                  <FileJson aria-hidden="true" />
                  JSON
                </a>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              CSV and Excel hold one row per person per expense, ready to sort
              and total. JSON is the complete record — every amount exactly as
              stored — and is the one to keep for an archive.
            </p>
            <p className="text-xs text-muted-foreground">
              Receipts are not in these files — download them from each expense.
            </p>
          </CardContent>
        </Card>
      )}

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
