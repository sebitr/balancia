import { UmamiScript } from "@/components/analytics/umami-script";
import { AreaMessages } from "@/i18n/area-messages";

/**
 * The onboarding flow's strings, which no screen but its three asks for.
 *
 * A layout rather than a wrapper in the page, because the page returns the
 * flow from two branches and relies on React seeing the same component in
 * both. `/invite` and `/join/start` mount the same area.
 *
 * The page counter is here and not on those two, and the difference is their
 * addresses: `/register` names nobody, and an invitation's path is a token.
 * It had been listed as a counted page since the counter existed and was one
 * only by accident — it sits outside the `(auth)` group that mounts the tag,
 * so it was counted when reached from the homepage and not when opened
 * directly, which is half a funnel.
 */
export default function RegisterLayout({ children }: LayoutProps<"/register">) {
  return (
    <AreaMessages area="onboarding">
      <UmamiScript />
      {children}
    </AreaMessages>
  );
}
