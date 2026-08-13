import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { CreateGroupForm } from "@/components/groups/create-group-form";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/security/actor";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("newGroupPage");
  return { title: t("metaTitle") };
}

export default async function NewGroupPage() {
  const user = await getCurrentUser();
  const t = await getTranslations("newGroupPage");
  const tCommon = await getTranslations("common");

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/dashboard">
            <ArrowLeft aria-hidden="true" />
            {tCommon("back")}
          </Link>
        </Button>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {t("title")}
        </h1>
      </div>

      <CreateGroupForm defaultName={user?.name ?? ""} defaultTimezone="UTC" />
    </div>
  );
}
