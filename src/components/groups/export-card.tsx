"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Braces,
  Download,
  Sheet,
  Table,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { PUSH } from "@/components/motion/transitions";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Taking the group's data out.
 *
 * Three buttons in a row said what the formats were called and nothing about
 * which one to pick, so they are a list now: each row explains what is in the
 * file, and JSON — the one to keep rather than the one to open — says so.
 *
 * Still plain anchors with `download`. The file is built by a route handler,
 * so the browser fetches it the way it fetches any other link and the toast is
 * only there to say the request left.
 *
 * The way back sits in the same card. Somebody who kept a JSON export looks for
 * the restore where they made the backup, not under a "Shortcuts" heading two
 * cards down — so the link is here, shown only to someone allowed to import.
 */
interface Format {
  readonly format: "csv" | "xlsx" | "json";
  readonly icon: LucideIcon;
  readonly label: string;
  readonly description: string;
  readonly pill?: string;
}

export function ExportCard({
  groupId,
  canImport,
}: {
  groupId: string;
  canImport: boolean;
}) {
  const t = useTranslations("settingsPage");

  const formats: Format[] = [
    {
      format: "csv",
      icon: Table,
      label: t("csv"),
      description: t("csvSub"),
    },
    {
      format: "xlsx",
      icon: Sheet,
      label: t("excel"),
      description: t("excelSub"),
    },
    {
      format: "json",
      icon: Braces,
      label: t("json"),
      description: t("jsonSub"),
      pill: t("jsonPill"),
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("export")}</CardTitle>
        <CardDescription className="text-xs text-pretty">
          {t("exportIntro")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2.5">
        <ul className="divide-y divide-border overflow-hidden rounded-lg border">
          {formats.map((entry) => (
            <li key={entry.format}>
              <a
                href={`/api/groups/${groupId}/export?format=${entry.format}`}
                download
                onClick={() =>
                  toast.success(t("exportStarted", { format: entry.label }))
                }
                className="flex items-center gap-2.5 px-3 py-2.5 transition-colors duration-150 hover:bg-muted/60"
              >
                <entry.icon
                  aria-hidden="true"
                  className="size-4.5 shrink-0 text-muted-foreground"
                  strokeWidth={1.5}
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {entry.label}
                    {entry.pill && (
                      <Badge variant="ghost" className="bg-muted px-1.5">
                        {entry.pill}
                      </Badge>
                    )}
                  </span>
                  <span className="text-xs text-pretty text-muted-foreground">
                    {entry.description}
                  </span>
                </span>
                <Download
                  aria-hidden="true"
                  className="ml-auto size-4 shrink-0 text-muted-foreground"
                />
              </a>
            </li>
          ))}
        </ul>
        <p className="text-xs text-pretty text-muted-foreground">
          {t("exportNote")}
        </p>
        {canImport && (
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-pretty text-muted-foreground">
            <Upload
              aria-hidden="true"
              className="size-3.5 shrink-0"
              strokeWidth={1.5}
            />
            {t("restoreNote")}
            <Link
              href={`/groups/${groupId}/import`}
              transitionTypes={PUSH}
              className="font-medium text-foreground underline underline-offset-4"
            >
              {t("restoreAction")}
            </Link>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
