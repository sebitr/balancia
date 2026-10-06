import { getTranslations } from "next-intl/server";

/**
 * The sign-in panel's one serif line, and the sentence under it.
 *
 * "Where do I stand?" is the question the whole app answers, set the way the
 * desktop board draws it. It is the only serif inside the product's chrome,
 * which `globals.css` reserves for marketing — so it is kept to this one
 * component, rendered from one line of `AuthPanel`, and the owner has not
 * ruled on it yet. If the ruling is no, delete this file and that line; the
 * panel keeps its wordmark and the instance's name, and nothing else refers
 * to these two strings.
 */
export async function PanelLine() {
  const t = await getTranslations("auth.panel");

  return (
    <div className="flex max-w-130 flex-col gap-4">
      {/* A display line, not a heading: the form beside it carries the
          page's one h1. */}
      <p className="font-editorial text-[3.5rem] leading-none xl:text-[4rem]">
        {t("headline")}
      </p>
      <p className="text-base text-pretty text-background/75 dark:text-muted-foreground">
        {t("lede")}
      </p>
    </div>
  );
}
