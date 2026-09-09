"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Mic } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  canProcessLocally,
  readCloudConsent,
  writeCloudConsent,
  type LocalCapableRecognition,
} from "./voice-consent";

/**
 * Saying the entry instead of typing it.
 *
 * One of the two ways in that skip the form, and the one that works while
 * somebody is holding a bag: "24 francs Coop" is a sentence, not four fields.
 * What is heard *proposes* — it fills the form and the reader confirms. A
 * wrong expense that saved itself is worse than no expense, because it is
 * wrong in the balances and nobody was watching.
 *
 * Renders nothing where the shortcut cannot work — no recogniser, which is
 * most browsers outside Chrome and Safari, or no network, because Chrome's
 * recogniser is a web service rather than something on the device. A button
 * that explains why it cannot work is worse than no button: this is a
 * shortcut, and the ordinary path is right there.
 *
 * The API is prefixed on every engine that has it and unspecified in TypeScript's
 * DOM library, so the shapes below are declared rather than imported. They are
 * the fields this component actually reads.
 */

interface SpeechResultAlternative {
  readonly transcript: string;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  /** Keep the audio on the device. Absent on engines that cannot. */
  processLocally?: boolean;
  start(): void;
  stop(): void;
  /** Finish without waiting for a result. Absent on some older engines. */
  abort?(): void;
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<SpeechResultAlternative>>;
      }) => void)
    | null;
  onspeechend: (() => void) | null;
  onerror: ((event: { readonly error: string }) => void) | null;
  onend: (() => void) | null;
}

type RecognitionConstructor = new () => SpeechRecognitionLike;

/**
 * How long a single sentence is given before the microphone is taken back.
 *
 * Long enough for anything anybody says to a form with three fields in it,
 * and short enough that a session nothing else closes cannot sit there
 * holding the microphone open.
 */
const CEILING_MS = 15_000;

function recogniser(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

/**
 * Whether the shortcut can work at all, right now.
 *
 * Two things, and the second is easy to forget: Chrome's recogniser is a web
 * service, not something on the device — "your audio is sent to a web service
 * for recognition processing, so it won't work offline". Offline, the button
 * is a control that opens the microphone, listens to a whole sentence and
 * fails, which is worse than not being there.
 */
function available(): boolean {
  if (recogniser() === null) return false;
  return typeof navigator === "undefined" || navigator.onLine;
}

/** The one thing that changes the answer is the network coming and going. */
function subscribeAvailability(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** Where a reader's own tag says nothing, the region to recognise against. */
const DEFAULT_REGION: Readonly<Record<string, string>> = {
  en: "en-US",
  fr: "fr-FR",
};

/**
 * The tag to listen in.
 *
 * The app's locale is a bare language — "en", "fr" — and a recogniser wants a
 * region on it. Chrome answers a tag it does not know with
 * `language-not-supported`, which looks from the outside exactly like hearing
 * nothing at all.
 *
 * The reader's own tag is the better guess whenever it is the same language,
 * because it is the accent they will speak in: a French speaker in Geneva is
 * `fr-CH`, and the app has no way to know that. The map is only the fallback.
 */
function recognitionLanguage(locale: string): string {
  const wanted = `${locale.toLowerCase()}-`;
  const offered =
    typeof navigator === "undefined"
      ? []
      : (navigator.languages ?? [navigator.language]);
  const regional = offered.find((tag) => tag.toLowerCase().startsWith(wanted));
  return regional ?? DEFAULT_REGION[locale] ?? locale;
}

/** Finish now, whether or not the engine has anything to say about it. */
function halt(recognition: SpeechRecognitionLike): void {
  if (recognition.abort) recognition.abort();
  else recognition.stop();
}

export function VoiceButton({
  onHeard,
  className,
}: {
  /** The whole transcript, once the recogniser has settled on one. */
  onHeard: (transcript: string) => void;
  className?: string;
}) {
  const t = useTranslations("addEntry.voice");
  const locale = useLocale();
  /*
   * Whether the shortcut can work, read as external state rather than
   * discovered in an effect.
   *
   * It is exactly that: a fact about the platform and the network, not
   * something React owns. The server snapshot is `false`, so the button is
   * absent in the markup and appears on hydration where it works — rather
   * than being rendered and then withdrawn, which is a control that flickers
   * away as somebody reaches for it.
   */
  const usable = useSyncExternalStore(
    subscribeAvailability,
    available,
    () => false,
  );
  const [listening, setListening] = useState(false);
  const active = useRef<SpeechRecognitionLike | null>(null);
  const ceiling = useRef<ReturnType<typeof setTimeout> | null>(null);
  const language = recognitionLanguage(locale);
  /*
   * Whether this engine can transcribe on the device, which decides whether
   * there is anything to ask about at all.
   *
   * Kept with the language it was asked about, so an answer about one
   * language is never read as a promise about another — and so a probe still
   * in flight reads as "no" rather than as "yes, probably". Unknown always
   * counts as no: that nothing leaves the device is not a thing to guess at.
   *
   * The probe is asynchronous and `start()` has to stay inside the click that
   * caused it, so it runs here rather than in the handler.
   */
  const [probe, setProbe] = useState<{ lang: string; local: boolean } | null>(
    null,
  );
  const localReady = probe?.lang === language && probe.local;
  const [asking, setAsking] = useState(false);

  /*
   * One way out of "listening", used by every path that ends a session.
   *
   * `onend` is not guaranteed to arrive — that is the whole reason the ceiling
   * below exists — so nothing may depend on it alone to put the button back.
   */
  const finish = () => {
    if (ceiling.current !== null) {
      clearTimeout(ceiling.current);
      ceiling.current = null;
    }
    active.current = null;
    setListening(false);
  };

  // Stop listening if the drawer closes mid-sentence.
  useEffect(
    () => () => {
      if (ceiling.current !== null) clearTimeout(ceiling.current);
      if (active.current) halt(active.current);
      active.current = null;
    },
    [],
  );

  /*
   * Going offline mid-sentence takes the button away, and a button that is
   * gone is one nobody can press to stop. Close the session with it, or the
   * microphone stays open behind a control that no longer exists.
   */
  useEffect(() => {
    if (usable || !active.current) return;
    halt(active.current);
    finish();
  }, [usable]);

  /* Asked once per language, and never while a session is open. */
  useEffect(() => {
    const Recognition = recogniser();
    if (!Recognition) return;
    let current = true;
    void canProcessLocally(
      Recognition as unknown as LocalCapableRecognition,
      language,
    ).then((local) => {
      if (current) setProbe({ lang: language, local });
    });
    return () => {
      current = false;
    };
  }, [language]);

  if (!usable) return null;

  const begin = (local: boolean) => {
    const Recognition = recogniser();
    if (!Recognition) return;

    const recognition = new Recognition();
    recognition.lang = language;
    // Only ever set where the engine said it could honour it; setting it
    // hopefully on an engine that cannot is how a promise gets broken.
    if (local) recognition.processLocally = true;
    recognition.interimResults = false;
    recognition.continuous = false;
    /*
     * `continuous = false` asks the engine for one utterance, and the engine
     * decides when that utterance ended. Where its endpointer does not — a
     * noisy room, a headset that holds the stream open — nothing else here
     * ever closed the session, and the button sat on "listening" with the
     * microphone live until the browser's own cap. So every path that means
     * "done" now says so out loud, which is what MDN's own example does:
     * stop on `speechend` rather than waiting to be told.
     */
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) onHeard(transcript);
      recognition.stop();
    };
    recognition.onspeechend = () => recognition.stop();
    recognition.onerror = (event) => {
      finish();
      /*
       * Nothing said, or the reader pressed stop again: the form is untouched
       * and they are looking at it. Silence is the answer, because the button
       * that stopped pulsing has already given it.
       *
       * Anything else is the shortcut *broken* rather than unused — the
       * microphone refused, the recogniser's service unreachable, the
       * language unsupported — and no button can say that by going quiet. It
       * is a refusal, so it is spoken, per `toastUndoable`'s doctrine in
       * src/components/ui/sonner.tsx. Swallowing these is what once let a
       * `Permissions-Policy` that never named the microphone look, for a
       * whole release, like a recogniser that simply never heard anything.
       */
      if (event.error === "no-speech" || event.error === "aborted") return;
      toast.error(t("failed"));
    };
    recognition.onend = finish;

    active.current = recognition;
    setListening(true);
    // The last resort, and the only one that does not trust the engine.
    ceiling.current = setTimeout(() => {
      halt(recognition);
      finish();
    }, CEILING_MS);

    try {
      recognition.start();
    } catch {
      // `start()` on an already-started recogniser throws, and the button was
      // already showing "listening" by then. Put it back.
      finish();
    }
  };

  /*
   * Nothing is asked where nothing leaves: an engine transcribing on the
   * device is the quiet path, and interrupting it to describe a risk it does
   * not carry would be a worse feature than no question at all.
   *
   * Everything else asks once. The answer is kept per browser rather than per
   * account, because what it consents to is *this* browser handing audio to
   * *its* vendor — a phone and a laptop are two different promises.
   */
  const listen = () => {
    if (listening) {
      active.current?.stop();
      return;
    }
    if (localReady) {
      begin(true);
      return;
    }
    if (readCloudConsent()) {
      begin(false);
      return;
    }
    setAsking(true);
  };

  /** Yes, once; or yes, and stop asking. Both start listening immediately. */
  const allow = (always: boolean) => {
    if (always) writeCloudConsent();
    setAsking(false);
    begin(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={listen}
        aria-pressed={listening}
        aria-label={listening ? t("stop") : t("start")}
        className={cn(
          "inline-flex h-11 items-center gap-2 rounded-xl border px-3 text-sm transition-colors",
          listening
            ? "border-primary bg-primary/15 font-semibold text-foreground"
            : "border-border bg-wash-1 text-muted-foreground",
          className,
        )}
      >
        <Mic
          aria-hidden="true"
          className={cn("size-4 shrink-0", listening && "animate-pulse")}
        />
        <span className="truncate">
          {listening ? t("listening") : t("start")}
        </span>
      </button>

      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("consent.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("consent.body")}</AlertDialogDescription>
          </AlertDialogHeader>
          {/*
           * Stacked at every width, unlike the two-button footers everywhere
           * else. Three of these will not sit in a row inside a `max-w-sm`
           * dialog — they overflow it — and a three-way choice reads better
           * as a list anyway. `flex-col-reverse` puts the DOM's last child on
           * top, so the order below is read bottom-up: listen once, listen
           * always, don't.
           */}
          <AlertDialogFooter className="sm:flex-col-reverse">
            <AlertDialogCancel>{t("consent.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="outline" onClick={() => allow(true)}>
              {t("consent.allowAlways")}
            </AlertDialogAction>
            <AlertDialogAction onClick={() => allow(false)}>
              {t("consent.allowOnce")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
