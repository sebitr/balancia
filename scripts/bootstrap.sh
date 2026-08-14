#!/bin/sh
# Balancia — first-run setup.
#
#   ./scripts/bootstrap.sh
#
# Writes the .env next to compose.yaml: this instance's own database password
# and auth secret, and — when there is a terminal to ask on — the answers to a
# short set of questions about the optional features. Nothing in this
# repository contains a usable production secret, so every install generates
# its own.
#
# Safe to re-run. A value already present in .env is never touched, and every
# question writes its answer, "no" included, so nothing is ever asked twice.
# That is what keeps it usable in front of Compose —
#
#   ./scripts/bootstrap.sh && docker compose up -d --build
#
# With no terminal on stdin (CI, a pipe) it asks nothing and writes only the
# secrets, exactly as it always did.
#
#   -y, --yes, --defaults   do not ask; write the secrets and leave every
#                           optional feature at its default, which is off
#   -h, --help              this text
#
# The secrets need only a POSIX shell and /dev/urandom: no openssl, no Node.
# Two of the optional features download model files, and for those it needs
# Node or Docker; without either it says which command to run instead.
set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
env_file="$root_dir/.env"

# One file out of each installer's manifest, used only to answer "are the
# models already here?". They are the paths the browser itself probes before
# offering the feature — see src/lib/ocr/config.ts and
# src/lib/semantic/config.ts.
ocr_sentinel="$root_dir/public/models/ocr/ppocrv5-mobile-rec.onnx"
semantic_sentinel="$root_dir/public/models/Xenova/paraphrase-multilingual-MiniLM-L12-v2/config.json"

usage() {
  cat <<'USAGE'
Balancia first-run setup. Writes .env next to compose.yaml.

  ./scripts/bootstrap.sh                 generate secrets, ask about features
  ./scripts/bootstrap.sh --defaults      generate secrets, ask nothing

  -y, --yes, --defaults   do not ask; leave every optional feature off
  -h, --help              this text

Safe to re-run: settings already in .env are left alone.
USAGE
}

interactive=1
for arg in "$@"; do
  case $arg in
    -y | --yes | --defaults) interactive=0 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      printf 'bootstrap.sh: unknown option "%s"\n\n' "$arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

# Questions need somewhere to ask. Without a terminal the script is being run
# by something rather than someone, and guessing on its behalf is worse than
# leaving the optional features at their documented defaults.
[ -t 0 ] || interactive=0

# Alphanumeric on purpose, not base64. The database password is spliced into a
# connection URL, where a literal '/', '#' or '?' would end the authority
# section — the port stops parsing as a number and PostgreSQL rejects the whole
# string with "Invalid URL". 40 alphanumerics is ~238 bits; the length is doing
# the work, not the alphabet.
random_alnum() {
  LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c "$1"
}

# Matches a key only when it has a non-empty value, so a commented-out or
# blank line left over from .env.example still gets filled in.
has_value() {
  grep -qE "^[[:space:]]*$1=.+" "$env_file"
}

# Mirrors the values src/lib/env.ts accepts as true, so that "is this feature
# on?" is answered here the same way the application answers it.
is_enabled() {
  grep -qiE "^[[:space:]]*$1=[\"']?(1|true|yes|on)[\"']?[[:space:]]*\$" "$env_file"
}

# Appends one setting, preceded by a blank line and a comment explaining it.
#
# Compose parses this file itself, and its parser is not a shell: an unquoted
# value runs to the end of the line, but a '$' is still interpolated and a
# ' #' still starts a comment. Single quotes stop both. That parser has no
# escape for a single quote inside single quotes, so a value containing one is
# handed back to be pasted by hand rather than written wrong.
write_setting() {
  _key=$1
  _value=$2
  _comment=$3

  case $_value in
    *"'"*)
      note_pending "$_key contains a single quote, which .env cannot quote. Add it by hand:
    $_key=$_value"
      return 0
      ;;
  esac

  printf '\n# %s\n' "$_comment" >> "$env_file"
  case $_value in
    '' | *[!A-Za-z0-9_@%+=:,./-]*) printf "%s='%s'\n" "$_key" "$_value" >> "$env_file" ;;
    *) printf '%s=%s\n' "$_key" "$_value" >> "$env_file" ;;
  esac
  written=1
}

# Things the operator still has to do, collected as they come up and printed
# once at the end, where they will not scroll past under a model download.
pending=''
note_pending() {
  pending="$pending  ! $1
"
}

lower() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

# The prompts below leave their answer in $reply rather than printing it: a
# command substitution would run `read` in a subshell, where the answer dies
# with it.
ask_yes_no() {
  if [ "$2" = y ]; then _hint='[Y/n]'; else _hint='[y/N]'; fi
  while :; do
    printf '%s %s ' "$1" "$_hint"
    read -r reply || {
      reply=''
      printf '\n'
    }
    case $(lower "$reply") in
      '') [ "$2" = y ] && return 0 || return 1 ;;
      y | yes) return 0 ;;
      n | no) return 1 ;;
      *) echo '  Please answer y or n.' ;;
    esac
  done
}

ask_line() {
  printf '%s ' "$1"
  [ -z "$2" ] || printf '[%s] ' "$2"
  read -r reply || {
    reply=''
    printf '\n'
  }
  [ -n "$reply" ] || reply=$2
}

# Reads without echoing. `read -s` is a bashism; stty is not.
ask_secret() {
  printf '%s ' "$1"
  if _stty_saved=$(stty -g 2> /dev/null); then
    stty -echo
    read -r reply || reply=''
    stty "$_stty_saved"
    printf '\n'
  else
    read -r reply || reply=''
  fi
}

# A terminal left with echo off is a terminal the operator has to fix by hand.
trap 'stty echo 2>/dev/null || :; printf "\nInterrupted. Settings written so far are in .env.\n"; exit 130' INT

heading() {
  printf '\n%s\n' "$1"
}

# Introduces the questions, on the first one that turns out to still need
# asking. A re-run with every answer already in .env should say nothing at all,
# and it cannot know that until it has been through the list.
intro_shown=0
question() {
  if [ "$intro_shown" -eq 0 ]; then
    intro_shown=1
    cat <<'INTRO'

Now a few questions about the optional features. Each answer is written to
.env and remembered, so this only happens once — press Enter to take the
default in brackets. Everything asked here can be changed later by editing
.env and restarting.
INTRO
  fi
  heading "$1"
}

# Splits an absolute URL into $url_host and $url_port. A bracketed IPv6
# literal is taken whole first, so that the ':' inside it is never mistaken
# for the port separator.
split_url() {
  _authority=${1#*://}
  _authority=${_authority%%/*}
  case $_authority in
    \[*\]*)
      url_host=${_authority%%\]*}]
      url_port=${_authority##*\]}
      url_port=${url_port#:}
      ;;
    *:*)
      url_host=${_authority%:*}
      url_port=${_authority##*:}
      ;;
    *)
      url_host=$_authority
      url_port=''
      ;;
  esac
}

# WebAuthn's rule, which src/lib/env.ts enforces at startup: HTTPS everywhere
# except localhost. An instance told otherwise refuses to boot, so the answer
# is rejected here rather than written and discovered later.
is_localhost() {
  case $1 in
    localhost | 127.0.0.1 | '[::1]' | *.localhost) return 0 ;;
    *) return 1 ;;
  esac
}

# The helpers in scripts/ stay the single source of truth for what is
# downloaded, from where, and how a VAPID pair is built. Running them from here
# means none of that is restated in shell, where it would drift.
#
# They are TypeScript, and two of them import from src/ without a file
# extension, which Node's own resolver refuses — so a loader is needed however
# Node arrives. In preference order: the repository's own tsx when the dev
# dependencies are installed, a throwaway copy from the registry when they are
# not, and a container for the host that runs Balancia with Docker and has no
# Node at all.
#
# A major rather than an exact version, because this is a type stripper
# borrowed for one command, not a dependency of the application. The pinned one
# in node_modules is used whenever it is there.
tsx_version=4

# Resolved once, on the first thing that needs it.
ts_runner=''

resolve_ts_runner() {
  [ -z "$ts_runner" ] || return 0

  if [ -x "$root_dir/node_modules/.bin/tsx" ]; then
    ts_runner=repo
  elif command -v npx > /dev/null 2>&1; then
    ts_runner=npx
  elif command -v docker > /dev/null 2>&1; then
    ts_runner=docker
    echo 'No Node on this host — borrowing one from a throwaway container.'
  else
    return 1
  fi
}

run_ts() {
  resolve_ts_runner || return 1
  case $ts_runner in
    repo) (cd "$root_dir" && ./node_modules/.bin/tsx "$@") ;;
    npx) (cd "$root_dir" && npx --yes "tsx@$tsx_version" "$@") ;;
    # HOME is set because npm caches under it, and the borrowed user id has no
    # home directory of its own inside the image.
    docker)
      docker run --rm --user "$(id -u):$(id -g)" --env HOME=/tmp \
        --volume "$root_dir:/repo" --workdir /repo \
        node:24-alpine npx --yes "tsx@$tsx_version" "$@"
      ;;
  esac
}

# Downloads the model files a feature needs, and says what to run by hand if it
# cannot. The flag on its own is not enough: with the models missing the
# browser renders no button and explains nothing, which is the silent failure
# both feature docs warn about.
install_models() {
  _script=$1
  _label=$2
  _sentinel=$3
  # Turning a feature back on after it was turned off should not re-fetch tens
  # of megabytes that are still sitting in public/models.
  if [ -e "$_sentinel" ]; then
    heading "The $_label model files are already in public/models."
    return 0
  fi
  heading "Installing the $_label model files. This downloads once."
  if run_ts "$_script" --yes; then
    return 0
  fi
  note_pending "The $_label models were not installed, so the feature will not
    appear. In a checkout with Node available, run:
    pnpm install && pnpm tsx $_script --yes"
  return 0
}

# Secrets, not world-readable.
umask 077

if [ ! -e "$env_file" ]; then
  cat > "$env_file" <<'HEADER'
# Balancia configuration — generated by scripts/bootstrap.sh.
#
# The secrets below are unique to this instance. Back this file up: losing
# AUTH_SECRET signs everyone out, and losing POSTGRES_PASSWORD locks you out of
# your own database.
#
# Everything below them was answered during setup and can be changed by hand;
# restart afterwards. Every remaining setting is documented in .env.example.
HEADER
  created=1
else
  created=0
fi

written=0

if ! has_value AUTH_SECRET; then
  printf '\n# Instance secret. Changing it signs everyone out.\nAUTH_SECRET=%s\n' \
    "$(random_alnum 64)" >> "$env_file"
  echo 'Generated AUTH_SECRET.'
  written=1
fi

if ! has_value POSTGRES_PASSWORD; then
  printf '\n# Database password. Applied when the cluster is first created.\nPOSTGRES_PASSWORD=%s\n' \
    "$(random_alnum 40)" >> "$env_file"
  echo 'Generated POSTGRES_PASSWORD.'
  written=1
fi

if [ "$interactive" -eq 1 ]; then
  # ── Where people reach it ─────────────────────────────────────────────────
  if ! has_value APP_URL; then
    question 'The address people will type into a browser. Behind a reverse
proxy this is the public HTTPS URL, not the container port. Passkeys
need HTTPS everywhere except localhost.'
    while :; do
      ask_line 'Public URL:' 'http://localhost:3000'
      app_url=$reply
      case $app_url in
        http://* | https://*) ;;
        *)
          echo '  Needs to start with http:// or https://.'
          continue
          ;;
      esac
      split_url "$app_url"
      if [ -z "$url_host" ]; then
        echo '  That URL has no host.'
        continue
      fi
      case $app_url in
        http://*)
          if ! is_localhost "$url_host"; then
            echo '  Browsers refuse passkeys on plain HTTP outside localhost, and'
            echo '  Balancia refuses to start with that combination. Use https://,'
            echo '  or localhost while you try it out.'
            continue
          fi
          ;;
      esac
      break
    done
    write_setting APP_URL "$app_url" \
      'The public URL people type. Must match exactly, scheme included.'

    # Compose publishes the app on ${APP_PORT:-3000}. A localhost URL naming
    # any other port would otherwise point at nothing.
    if is_localhost "$url_host" && [ -n "$url_port" ] && [ "$url_port" != 3000 ]; then
      write_setting APP_PORT "$url_port" \
        'Host port Compose publishes the app on, matching APP_URL.'
    fi
  fi

  # ── Registration ──────────────────────────────────────────────────────────
  if ! has_value ALLOW_REGISTRATION; then
    question 'Anyone who can reach this instance may create an account. On a
private instance, close sign-ups once your own account exists.'
    if ask_yes_no 'Allow open registration?' y; then
      write_setting ALLOW_REGISTRATION true \
        'Open sign-ups. Set to false to close them on a private instance.'
    else
      write_setting ALLOW_REGISTRATION false \
        'Sign-ups closed. Set to true to reopen them.'
    fi
  fi

  # ── Exchange rates ────────────────────────────────────────────────────────
  if ! has_value EXCHANGE_RATE_PROVIDER; then
    question "Groups that convert to one base currency can have the day's rate
filled in from the European Central Bank's published figures, through
api.frankfurter.dev. No API key. Rates are cached in your database and
can always be typed by hand; recorded rates are never recalculated.
This is the only routine outbound request Balancia makes."
    if ask_yes_no 'Suggest daily exchange rates?' n; then
      write_setting EXCHANGE_RATE_PROVIDER frankfurter \
        'Rate suggestions from api.frankfurter.dev. "none" turns them off.'
    else
      write_setting EXCHANGE_RATE_PROVIDER none \
        'No rate provider: rates are typed by hand. "frankfurter" turns them on.'
    fi
  fi

  # ── Receipt scanning ──────────────────────────────────────────────────────
  if ! has_value RECEIPT_SCANNING; then
    question 'Photograph a receipt and have it read into an expense — merchant,
date, line items and total — which you then correct and assign to
people. Recognition runs in the browser against model files this
instance serves: the image is never uploaded to be read, and there is
no OCR service involved. Costs a ~47 MB download now, and relaxes the
Content-Security-Policy with '"'"'wasm-unsafe-eval'"'"'.'
    if ask_yes_no 'Enable receipt scanning?' n; then
      write_setting RECEIPT_SCANNING true \
        'On-device receipt scanning. Needs the models in public/models.'
      install_models scripts/fetch-ocr-model.ts OCR "$ocr_sentinel"
    else
      write_setting RECEIPT_SCANNING false \
        'Receipt scanning off. See docs/receipt-scanning.md to turn it on.'
    fi
  fi

  # ── Semantic categorization ───────────────────────────────────────────────
  if ! has_value SEMANTIC_CATEGORIZATION; then
    question 'Expense categories are suggested by rules that ship with Balancia,
with no configuration and no outbound requests. This adds a semantic
fallback for descriptions the rules do not cover, inferred in the
browser, so no transaction text leaves the device. Costs a ~150 MB
download now, and the same CSP relaxation as above.'
    if ask_yes_no 'Enable semantic categorization?' n; then
      write_setting SEMANTIC_CATEGORIZATION true \
        'Semantic category fallback. Needs the model in public/models.'
      install_models scripts/fetch-semantic-model.ts 'categorization' "$semantic_sentinel"
    else
      write_setting SEMANTIC_CATEGORIZATION false \
        'Semantic fallback off; the built-in rules still categorize.'
    fi
  fi

  # ── Push notifications ────────────────────────────────────────────────────
  if ! has_value PUSH_VAPID_PUBLIC_KEY; then
    question "Notifications appear inside the app either way. Push adds reaching
a device while Balancia is closed. The messages are relayed by the
browser vendor's push service (Google, Mozilla, Apple): payloads are
encrypted end to end so the relay cannot read them, but it does see
that a message reached a device."
    if ask_yes_no 'Enable push notifications?' n; then
      # The same P-256 pair `pnpm push:keys` prints, generated by the same
      # code — the padding of a short scalar in src/lib/push/keys.ts is the
      # sort of detail a shell reimplementation would get wrong once in 256
      # keys.
      push_keys=$(run_ts scripts/generate-push-keys.ts 2> /dev/null || :)
      push_public=$(printf '%s\n' "$push_keys" | sed -n 's/^PUSH_VAPID_PUBLIC_KEY=//p')
      push_private=$(printf '%s\n' "$push_keys" | sed -n 's/^PUSH_VAPID_PRIVATE_KEY=//p')

      if [ -n "$push_public" ] && [ -n "$push_private" ]; then
        echo '  Generated a VAPID key pair. Replacing it later makes every browser'
        echo '  subscribe again, so keep it with the rest of your secrets.'
        # Handed to Google, Mozilla and Apple inside every VAPID token, so it is
        # asked for rather than guessed.
        while :; do
          ask_line 'Contact address for the push services (an email):' ''
          case $reply in
            '') echo '  Needed: the push services require a contact address.' ;;
            mailto:* | https://*)
              push_subject=$reply
              break
              ;;
            *@*.*)
              push_subject="mailto:$reply"
              break
              ;;
            *) echo '  Needs to be an email address, or a "mailto:"/"https://" URL.' ;;
          esac
        done
        write_setting PUSH_VAPID_PUBLIC_KEY "$push_public" \
          'Web Push (VAPID). Regenerating the pair invalidates every subscription.'
        write_setting PUSH_VAPID_PRIVATE_KEY "$push_private" \
          'The private half. A secret.'
        write_setting PUSH_VAPID_SUBJECT "$push_subject" \
          'Contact address carried in every VAPID token.'
      else
        # Nothing is written, so the question comes back once Node is there.
        note_pending 'Push keys could not be generated here. Run
    pnpm push:keys
    and copy the three lines into .env, or re-run this script later.'
      fi
    else
      # An explicit empty pair is what stops this being asked again; both
      # halves unset is exactly how src/lib/env.ts spells "push is off".
      write_setting PUSH_VAPID_PUBLIC_KEY '' \
        'Push off. Fill both halves in from `pnpm push:keys` to turn it on.'
      write_setting PUSH_VAPID_PRIVATE_KEY '' \
        'The private half of the pair above.'
    fi
  fi

  # ── Outgoing email ────────────────────────────────────────────────────────
  if ! has_value SMTP_HOST; then
    question 'Without SMTP, Balancia works fully but cannot verify an email
address or send a password-recovery link. Passkeys and passwords both
work without it.'
    if ask_yes_no 'Configure outgoing email?' n; then
      ask_line 'SMTP host:' ''
      smtp_host=$reply
      if [ -z "$smtp_host" ]; then
        echo '  No host given — leaving email off. Run this again to set it up.'
      else
        # src/lib/env.ts coerces this to a number and rejects anything outside
        # 1–65535, which stops the app booting. Catch it while it can be retyped.
        while :; do
          ask_line 'SMTP port:' '587'
          smtp_port=$reply
          case $smtp_port in
            '' | *[!0-9]*) echo '  Ports are digits, usually 587 or 465.' ;;
            *) break ;;
          esac
        done
        ask_line 'SMTP username (blank for none):' ''
        smtp_user=$reply
        smtp_password=''
        if [ -n "$smtp_user" ]; then
          ask_secret 'SMTP password:'
          smtp_password=$reply
        fi
        # Implicit TLS from the first byte, which is what port 465 expects.
        # Port 587 starts in the clear and upgrades with STARTTLS, which the
        # mailer does on its own.
        if ask_yes_no 'Connect with TLS immediately (usually port 465)?' n; then
          smtp_secure=true
        else
          smtp_secure=false
        fi
        ask_line 'From address:' "balancia@$smtp_host"
        smtp_from=$reply

        write_setting SMTP_HOST "$smtp_host" 'Outgoing mail. Blank turns email off.'
        write_setting SMTP_PORT "$smtp_port" 'Usually 587 (STARTTLS) or 465 (TLS).'
        write_setting SMTP_USER "$smtp_user" 'Blank for a relay that needs no login.'
        write_setting SMTP_PASSWORD "$smtp_password" 'A secret.'
        write_setting SMTP_SECURE "$smtp_secure" 'true for implicit TLS, false for STARTTLS.'
        write_setting SMTP_FROM "$smtp_from" 'Envelope sender. Required whenever SMTP_HOST is set.'
      fi
    else
      write_setting SMTP_HOST '' \
        'No outgoing email: no address verification, no password recovery.'
    fi
  fi
fi

# A feature switched on whose model files are missing is the failure both
# docs/receipt-scanning.md and docs/categorization.md warn about: the browser
# renders no button and says nothing. Checked on every run, because the
# download may have failed after the flag was written.
if [ "$interactive" -eq 1 ]; then
  if is_enabled RECEIPT_SCANNING && [ ! -e "$ocr_sentinel" ]; then
    heading 'RECEIPT_SCANNING is on, but the OCR models are not in public/models.
Without them the scan button never appears.'
    if ask_yes_no 'Install them now (~47 MB)?' y; then
      install_models scripts/fetch-ocr-model.ts OCR "$ocr_sentinel"
    fi
  fi

  if is_enabled SEMANTIC_CATEGORIZATION && [ ! -e "$semantic_sentinel" ]; then
    heading 'SEMANTIC_CATEGORIZATION is on, but the model is not in public/models.
Without it categorization falls back to its built-in rules.'
    if ask_yes_no 'Install it now (~150 MB)?' y; then
      install_models scripts/fetch-semantic-model.ts 'categorization' "$semantic_sentinel"
    fi
  fi
fi

chmod 600 "$env_file"

if [ "$written" -eq 0 ]; then
  echo
  echo '.env already holds every answer — left untouched.'
elif [ "$created" -eq 1 ]; then
  echo
  echo 'Wrote .env. Back it up; it is the only copy of these secrets.'
else
  echo
  echo 'Updated .env. Back it up; it is the only copy of these secrets.'
fi

if [ -n "$pending" ]; then
  echo
  echo 'Still to do:'
  printf '%s' "$pending"
fi

if [ "$interactive" -eq 0 ] && [ "$written" -eq 1 ]; then
  echo 'Optional features left at their defaults. Re-run in a terminal to be asked about them.'
fi

echo
echo 'Next:  docker compose up -d --build'

exit 0
