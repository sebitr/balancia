"use client";

import { useEffect } from "react";

/**
 * The page for a failure in the root layout itself.
 *
 * The root layout awaits the locale, the reader's formats, their starred
 * currencies, their accent and their surfaces before it draws anything, and a
 * throw in any of those used to reach Next's built-in page: unstyled, and in
 * English whatever the reader's language. This replaces that page.
 *
 * It replaces the root layout too, which is the whole difficulty. There is no
 * `<html>` but this one, no stylesheet, no fonts, and no message catalogue —
 * the catalogue is exactly what the failed layout was busy loading — so it
 * cannot be translated the way every other screen is. It says its few words
 * in the app's two maintained languages instead, English first as the
 * catalogue's reference, and marks the French as French so a screen reader
 * switches voice for it. Colours are the system's own, which follow the
 * reader's light or dark setting with nothing to load.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          colorScheme: "light dark",
          background: "Canvas",
          color: "CanvasText",
          fontFamily: "system-ui, sans-serif",
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          padding: "0 1rem",
          textAlign: "center",
        }}
      >
        <title>Balancia</title>
        <h1 style={{ fontSize: "1.5rem", margin: 0 }}>
          Something went wrong
          <br />
          <span lang="fr">Une erreur est survenue</span>
        </h1>
        <p style={{ maxWidth: "28rem", margin: 0, opacity: 0.75 }}>
          Balancia could not be displayed. Nothing you were doing has been
          saved.
          <br />
          <span lang="fr">
            Balancia n’a pas pu s’afficher. Rien de ce que tu faisais n’a été
            enregistré.
          </span>
        </p>
        {error.digest && (
          <p
            style={{
              fontFamily: "ui-monospace, monospace",
              fontSize: "0.75rem",
              margin: 0,
              opacity: 0.75,
            }}
          >
            {error.digest}
          </p>
        )}
        <button
          type="button"
          onClick={retry}
          style={{
            font: "inherit",
            minHeight: "2.75rem",
            padding: "0 1.25rem",
            borderRadius: "0.75rem",
          }}
        >
          Try again · <span lang="fr">Réessayer</span>
        </button>
      </body>
    </html>
  );
}
