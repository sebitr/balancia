import { permanentRedirect } from "next/navigation";

/**
 * Where the telemetry admin page used to be. It is a screen of the settings
 * hub now, shown only to an instance administrator — the same check, made on
 * the page it moved to.
 */
export default function TelemetryAdminRedirect() {
  permanentRedirect("/settings/admin");
}
