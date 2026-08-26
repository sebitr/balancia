import { getTranslations } from "next-intl/server";
import { FlaskConical } from "lucide-react";
import { getEnv } from "@/lib/env";

/**
 * The standing reminder that this is not somebody's real money.
 *
 * On every signed-in screen rather than only the first, because the whole
 * point of the demo is that it is indistinguishable from the product — a
 * visitor three screens in has no other way to tell, and someone who arrives
 * on a shared link never saw the sign-in page at all.
 *
 * Renders nothing on a real instance, which is every instance but one.
 */
export async function DemoBanner() {
  if (!getEnv().DEMO_MODE) return null;

  const t = await getTranslations("demo");

  return (
    <div
      data-slot="demo-banner"
      className="border-b bg-muted/60 px-4 py-2 text-center text-xs text-muted-foreground"
    >
      <p className="mx-auto flex max-w-3xl items-center justify-center gap-2">
        <FlaskConical aria-hidden="true" className="size-3.5 shrink-0" />
        <span>{t("bannerBody")}</span>
      </p>
    </div>
  );
}
