import { permanentRedirect } from "next/navigation";

/**
 * Where the profile page used to be.
 *
 * Settings moved out of `/profile` and `/admin` into one hub at `/settings`,
 * and the account screen is what this page became. The redirect is permanent
 * because the old address is not coming back, and it carries the query string
 * with it: `/confirm-email` used to land here with `?emailChange=…`, and a
 * link somebody opened from an email a week ago still should say whether the
 * address changed.
 */
export default async function ProfileRedirect({
  searchParams,
}: PageProps<"/profile">) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === "string") params.set(key, value);
  }
  const query = params.toString();
  permanentRedirect(`/settings/account${query ? `?${query}` : ""}`);
}
