import { AreaMessages } from "@/i18n/area-messages";

/**
 * The onboarding flow's strings, which no screen but its three asks for.
 *
 * A layout rather than a wrapper in the page, because the page returns the
 * flow from two branches and relies on React seeing the same component in
 * both. `/register` and `/invite` mount the same area.
 */
export default function JoinStartLayout({
  children,
}: LayoutProps<"/join/start">) {
  return <AreaMessages area="onboarding">{children}</AreaMessages>;
}
