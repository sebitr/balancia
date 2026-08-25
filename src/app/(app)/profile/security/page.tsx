import { permanentRedirect } from "next/navigation";

/**
 * Where the security page used to be. The Apple round trip landed here with
 * `?error=` or `?linked=apple`, so the query string travels with the redirect.
 */
export default async function SecurityRedirect({
  searchParams,
}: PageProps<"/profile/security">) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === "string") params.set(key, value);
  }
  const query = params.toString();
  permanentRedirect(`/settings/security${query ? `?${query}` : ""}`);
}
