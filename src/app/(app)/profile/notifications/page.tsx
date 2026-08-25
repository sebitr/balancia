import { permanentRedirect } from "next/navigation";

/** Where the notification settings used to be. */
export default function NotificationSettingsRedirect() {
  permanentRedirect("/settings/notifications");
}
