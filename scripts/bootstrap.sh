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
#   --color, --no-color     settle the colour rather than detecting it
#
# Output is coloured when stdout is a terminal, unless NO_COLOR is set or TERM
# is "dumb". Piped, redirected, or run by `docker run` without -t, there is no
# terminal and it comes out as plain text — pass --color, or set FORCE_COLOR,
# to colour it anyway.
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
ocr_sentinel="$root_dir/public/models/ocr/ppocrv6-tiny-det.onnx"
semantic_sentinel="$root_dir/public/models/Xenova/paraphrase-multilingual-MiniLM-L12-v2/config.json"

# The settings the questions below write, in the order they are asked. Kept as
# a list as well as in the code so the prompts can say "3 of 7" — a wizard that
# will not say how long it is stays longer than it should. One name per
# question block; adding a block means adding a name.
question_keys='APP_URL ALLOW_REGISTRATION DEMO_URL EXCHANGE_RATE_PROVIDER RECEIPT_SCANNING SEMANTIC_CATEGORIZATION PUSH_VAPID_PUBLIC_KEY SMTP_HOST TELEMETRY_MODE METRICS_ENABLED'

# ── Presentation ────────────────────────────────────────────────────────────

# Colour when stdout is a terminal that wants it, and nothing at all otherwise:
# these strings are also the ones that would end up inside .env or a log file.
# NO_COLOR is the convention at no-color.org, TERM=dumb the older one.
#
# Detection is only a default, because it is wrong in both directions often
# enough to be worth overriding: run through a pipe, a pager, `docker run`
# without -t, or a CI shell, stdout is not a terminal and the colour goes away
# with no way to ask for it back. --color and --no-color settle it, and are
# read here in their own pass because usage() needs the palette before the
# real argument loop runs.
colour=auto
for arg in "$@"; do
  case $arg in
    --color | --colour) colour=always ;;
    --no-color | --no-colour) colour=never ;;
  esac
done

# In precedence order: the flag, then NO_COLOR, then the FORCE_COLOR pair a
# scripted caller uses to keep colour through a pipe, then the terminal itself.
want_colour() {
  case $colour in
    always) return 0 ;;
    never) return 1 ;;
  esac
  [ -z "${NO_COLOR-}" ] || return 1
  [ -z "${FORCE_COLOR-}" ] || return 0
  [ -z "${CLICOLOR_FORCE-}" ] || return 0
  [ -t 1 ] && [ "${TERM-}" != dumb ]
}

if want_colour; then
  bold=$(printf '\033[1m')
  dim=$(printf '\033[2m')
  red=$(printf '\033[31m')
  green=$(printf '\033[32m')
  yellow=$(printf '\033[33m')
  cyan=$(printf '\033[36m')
  reset=$(printf '\033[0m')
else
  bold=''
  dim=''
  red=''
  green=''
  yellow=''
  cyan=''
  reset=''
fi

# Two indents: headings sit at 2, everything belonging to a heading at 6.
pad='      '

banner() {
  printf '\n  %sBalancia%s — first-run setup\n' "$bold" "$reset"
  printf '  %s────────────────────────────%s\n\n' "$dim" "$reset"
}

# Body text, fed a heredoc so the source reads as prose rather than as a
# string with newlines in it.
prose() {
  while IFS= read -r _line; do
    if [ -z "$_line" ]; then
      printf '\n'
    else
      printf '%s%s\n' "$pad" "$_line"
    fi
  done
}

done_line() {
  printf '  %s✓%s  %s\n' "$green" "$reset" "$1"
}

# Under a prompt, in the same column as the prompt itself.
oops() {
  printf '%s%s✗%s %s\n' "$pad" "$red" "$reset" "$1"
}

note() {
  printf '%s%s\n' "$pad" "$1"
}

# ── .env ────────────────────────────────────────────────────────────────────

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

# The value as the application will see it: last assignment wins, one layer of
# quoting removed. Only used for the closing summary.
value_of() {
  _raw=$(grep -E "^[[:space:]]*$1=" "$env_file" 2> /dev/null | tail -n 1 | sed "s/^[[:space:]]*$1=//")
  case $_raw in
    "'"*"'")
      _raw=${_raw#\'}
      _raw=${_raw%\'}
      ;;
    '"'*'"')
      _raw=${_raw#\"}
      _raw=${_raw%\"}
      ;;
  esac
  printf '%s' "$_raw"
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
      note_pending "$_key contains a single quote, which .env cannot quote.
Add it by hand:
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
#
# The marker goes on the first line and every later line is indented to sit
# under it, so callers write the message as plain wrapped prose and do not each
# have to know how wide the marker is.
pending=''
note_pending() {
  pending="$pending$(
    printf '%s\n' "$1" | {
      _n=0
      while IFS= read -r _line; do
        _n=$((_n + 1))
        if [ "$_n" -eq 1 ]; then
          printf '  %s!%s  %s\n' "$yellow" "$reset" "$_line"
        else
          printf '     %s\n' "$_line"
        fi
      done
    }
  )
"
}

# ── Prompts ─────────────────────────────────────────────────────────────────

lower() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

# The prompts below leave their answer in $reply rather than printing it: a
# command substitution would run `read` in a subshell, where the answer dies
# with it.
ask_yes_no() {
  if [ "$2" = y ]; then _hint='Y/n'; else _hint='y/N'; fi
  while :; do
    printf '%s%s%s%s %s[%s]%s ▸ ' "$pad" "$bold" "$1" "$reset" "$dim" "$_hint" "$reset"
    read -r reply || {
      reply=''
      printf '\n'
    }
    case $(lower "$reply") in
      '') [ "$2" = y ] && return 0 || return 1 ;;
      y | yes) return 0 ;;
      n | no) return 1 ;;
      *) oops 'Please answer y or n.' ;;
    esac
  done
}

ask_line() {
  printf '%s%s%s%s ' "$pad" "$bold" "$1" "$reset"
  [ -z "$2" ] || printf '%s[%s]%s ' "$dim" "$2" "$reset"
  printf '▸ '
  read -r reply || {
    reply=''
    printf '\n'
  }
  [ -n "$reply" ] || reply=$2
}

# Reads without echoing. `read -s` is a bashism; stty is not.
ask_secret() {
  printf '%s%s%s%s ▸ ' "$pad" "$bold" "$1" "$reset"
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
trap 'stty echo 2>/dev/null || :; printf "\n\n  %sInterrupted.%s Settings written so far are in .env.\n\n" "$yellow" "$reset"; exit 130' INT

heading() {
  printf '\n  %s%s%s\n\n' "$bold" "$1" "$reset"
}

# Numbered heading for a question, introduced on the first one that turns out
# to still need asking: a re-run with every answer already in .env should say
# nothing at all, and it cannot know that until it has been through the list.
questions_total=0
questions_asked=0
question() {
  # At the banner's indent rather than the body's: it introduces the whole
  # run, not the question it happens to come before.
  if [ "$questions_asked" -eq 0 ]; then
    cat <<'INTRO'

  A few questions about the optional features. Every answer is written to
  .env and remembered, so this only happens once — press Enter to take the
  default in brackets, and change any of it later by editing .env.
INTRO
  fi
  questions_asked=$((questions_asked + 1))
  printf '\n  %s%s/%s%s  %s%s%s\n\n' \
    "$cyan" "$questions_asked" "$questions_total" "$reset" "$bold" "$1" "$reset"
}

# ── Model files ─────────────────────────────────────────────────────────────

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
    note 'No Node on this host — borrowing one from a throwaway container.'
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
# Which reader receipts are read by.
#
# Nested inside the receipt-scanning question rather than asked as its own
# numbered one: it only matters to the operators who said yes, and the "3 of 7"
# counter above stays honest with one name per question block.
#
# The two are not exclusive. An operator can have both and let each person
# choose per scan, which is why the local answer does not rule out a provider
# and the provider answer asks before turning local off.
choose_receipt_reader() {
  prose <<'TEXT'
On this device: a ~32 MB model download now, and the photo is never
uploaded to be read. It also relaxes the Content-Security-Policy with
'wasm-unsafe-eval', which WebAssembly needs. This reads an ordinary
receipt well and costs nothing per scan.

Through a provider: no download and no CSP change, but the photo is
sent by this server to whoever you configure. Worth it for what the
small model cannot do — handwriting, unusual layouts, scripts outside
its dictionary — and for getting structure back instead of text a
parser has to interpret. Point the openai driver at your own Ollama
or vLLM and it stays on your hardware.

TEXT

  if ask_yes_no 'Read receipts on the device (no upload)?' y; then
    write_setting RECEIPT_OCR_LOCAL true \
      'On-device receipt reading. Needs the models in public/models.'
    install_models scripts/fetch-ocr-model.ts OCR "$ocr_sentinel"
    ask_yes_no 'Also offer a server-side provider?' n || return 0
  else
    # Deferred: writing it now would be wrong if they decline a provider
    # below and we have to put the on-device reader back.
    prose <<'TEXT'
Then a provider is required — receipt scanning needs a reader.

TEXT
  fi

  # The choice costs money on every scan from here on, so the figures belong
  # at the moment it is made rather than only in the documentation. Rounded
  # and dated on purpose: precise-looking numbers that have gone stale are
  # worse than round ones that are obviously approximate.
  prose <<'TEXT'
Roughly, per 1000 receipts, as of August 2026:

  your own GPU   free     most accurate, and nothing leaves your box
  gemini         $0.33    cheapest hosted
  openai         $1.70    mid-range
  mistral        $2-4     flat per page; the older generation is the $2
  anthropic      $16-33   most capable, and much the most expensive

"Your own GPU" is the openai option with a base URL pointing at your
own Ollama or vLLM. On current open-weight document models it scores
above every hosted one and costs nothing per scan.

There is no independent receipt benchmark, and those accuracy claims
come from document-parsing tests, which are a proxy for reading a
crumpled receipt. docs/receipt-scanning.md shows the workings.

TEXT

  local provider=''
  while :; do
    ask_line 'Provider (anthropic, gemini, mistral, openai)' anthropic
    case $(lower "$reply") in
      anthropic | gemini | mistral | openai) provider=$(lower "$reply"); break ;;
      *) oops 'Pick one of anthropic, gemini, mistral or openai.' ;;
    esac
  done

  # Two of the four have a default. See src/lib/env.ts: naming one for the
  # other two here would be a 404 at the first scan the day it moves — so they
  # are asked for, and the asking says what sort of answer is wanted.
  local model=''
  case $provider in
    anthropic)
      note 'Defaults to claude-opus-5 — the capable end, and the pricey end.'
      note 'Name a smaller model here to cut the bill.'
      ;;
    mistral)
      note 'Two generations, and the older one is half the price:'
      note '  mistral-ocr-4-1   $4 / 1000   block labels and confidences'
      note '  mistral-ocr-2505  $2 / 1000   the generation before it'
      note 'Blank takes mistral-ocr-latest, which tracks the newest — and'
      note 'so the dearer — of the two. Check the older id against'
      note "Mistral's model list; dated snapshots do get retired."
      ;;
    gemini)
      note 'Name a vision model. A Flash-Lite class one is the cheap choice.'
      ;;
    openai)
      note 'Name the model your endpoint serves. Against your own Ollama or'
      note 'vLLM, a document model such as PaddleOCR-VL or dots.ocr.'
      ;;
  esac

  if [ "$provider" = anthropic ] || [ "$provider" = mistral ]; then
    ask_line 'Model (blank for the default)' ''
    model=$reply
  else
    while :; do
      ask_line 'Model' ''
      [ -n "$reply" ] && { model=$reply; break; }
      oops 'A model is required for this provider.'
    done
  fi

  ask_line 'Base URL (blank for the vendor default)' ''
  local base_url=$reply

  # A local endpoint usually wants no key, so an empty answer is allowed
  # whenever a base URL was given.
  local key=''
  while :; do
    ask_secret 'API key (blank if the endpoint needs none)'
    key=$reply
    if [ -n "$key" ] || [ -n "$base_url" ]; then
      break
    fi
    oops 'A key is required unless you gave a base URL.'
  done

  write_setting RECEIPT_OCR_PROVIDER "$provider" \
    'Server-side receipt reader. "none" turns it off.'
  [ -n "$key" ] && write_setting RECEIPT_OCR_API_KEY "$key" \
    'Credential for the reader above. Kept on this server.'
  [ -n "$base_url" ] && write_setting RECEIPT_OCR_BASE_URL "$base_url" \
    'Endpoint override — an OpenAI-compatible server, including your own.'
  [ -n "$model" ] && write_setting RECEIPT_OCR_MODEL "$model" \
    'Model the reader should use.'

  # Now safe to record: they have a reader either way.
  has_value RECEIPT_OCR_LOCAL || write_setting RECEIPT_OCR_LOCAL false \
    'On-device reading off; receipts are read by the provider above.'
}

install_models() {
  _script=$1
  _label=$2
  _sentinel=$3
  # Turning a feature back on after it was turned off should not re-fetch tens
  # of megabytes that are still sitting in public/models.
  if [ -e "$_sentinel" ]; then
    note "The $_label model files are already in public/models."
    return 0
  fi
  note "Fetching the $_label model files. This downloads once."
  printf '\n'
  if run_ts "$_script" --yes; then
    printf '\n'
    return 0
  fi
  printf '\n'
  note_pending "The $_label models were not installed, so the feature will
not appear. In a checkout with Node available, run:
  pnpm install && pnpm tsx $_script --yes"
  return 0
}

# ── URLs ────────────────────────────────────────────────────────────────────

# Splits an absolute URL into $url_scheme, $url_host, $url_port and $url_path
# — the pieces needed to put it back together with a different port. A
# bracketed IPv6 literal is taken whole first, so that the ':' inside it is
# never mistaken for the port separator.
split_url() {
  url_scheme=${1%%://*}
  _rest=${1#*://}
  # Everything from the first '/' onwards, if there is one.
  case $_rest in
    */*) url_path=/${_rest#*/} ;;
    *) url_path='' ;;
  esac
  _authority=${_rest%%/*}
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

# ── Ports ───────────────────────────────────────────────────────────────────

# Reads a table of sockets on stdin and answers whether any of them is
# listening on port $1. Both `ss -ltn` and `netstat -an` put the local address
# in the fourth column and spell the state LISTEN — at the front of the line in
# ss, at the end of it in netstat.
#
# The separator before the number is part of the match, or port 3000 is found
# inside 13000. BSD and macOS write that separator as a dot rather than a
# colon, and a wildcard address as '*' rather than '0.0.0.0'.
listens_on() {
  awk -v want="$1" '
    ($1 == "LISTEN" || $NF == "LISTEN") && $4 ~ ("[:.]" want "$") { hit = 1 }
    END { exit hit ? 0 : 1 }
  '
}

# Whether something already holds this TCP port on this host, asked of
# whichever tool the host has: ss on any current Linux, netstat on macOS and
# older Linux, lsof where neither is installed.
#
# A connect test would be shorter and wrong: it cannot see a listener bound to
# a single interface, which is exactly the kind Compose then collides with —
# publishing a port binds the wildcard address, and that fails against any
# listener already on the number.
#
# Only a sighting counts. Where none of the three is installed the answer is
# "free", which is where this script stood before it asked at all: better than
# arguing with an operator about a port on no evidence. The same goes for a
# check run inside a container, which is looking at that container's network
# namespace rather than the host's.
port_taken() {
  _port=$1
  if command -v ss > /dev/null 2>&1 && ss -ltn 2> /dev/null | listens_on "$_port"; then
    return 0
  fi
  if command -v netstat > /dev/null 2>&1 && netstat -an 2> /dev/null | listens_on "$_port"; then
    return 0
  fi
  # Unprivileged lsof sees only this user's own sockets, so it comes last and
  # is believed only when it says yes.
  if command -v lsof > /dev/null 2>&1 &&
    lsof -nP -iTCP:"$_port" -sTCP:LISTEN > /dev/null 2>&1; then
    return 0
  fi
  return 1
}

# A whole number in 1–65535. The width is checked before the value, because a
# long enough string of digits makes the shell's own arithmetic complain
# instead of answering.
is_port() {
  case $1 in
    '' | *[!0-9]*) return 1 ;;
  esac
  [ "${#1}" -le 5 ] || return 1
  [ "$1" -ge 1 ] && [ "$1" -le 65535 ]
}

# The first free port at or after $1, printed, as an opening offer. Bounded
# because a host with thirty consecutive ports spoken for has an operator who
# already knows which number they want.
suggest_port() {
  _try=$1
  _last=$((_try + 30))
  while [ "$_try" -le "$_last" ] && [ "$_try" -le 65535 ]; do
    if ! port_taken "$_try"; then
      printf '%s' "$_try"
      return 0
    fi
    _try=$((_try + 1))
  done
  return 1
}

# ── Command line ────────────────────────────────────────────────────────────

usage() {
  printf '\n  %sBalancia first-run setup.%s Writes .env next to compose.yaml.\n\n' \
    "$bold" "$reset"
  cat <<USAGE
    ./scripts/bootstrap.sh                generate secrets, ask about features
    ./scripts/bootstrap.sh --defaults     generate secrets, ask nothing

    -y, --yes, --defaults   do not ask; leave every optional feature off
        --color             colour the output even when stdout is not a
                            terminal — a pipe, a pager, docker run without -t
        --no-color          never colour it
    -h, --help              this text

  Safe to re-run: settings already in .env are left alone.

USAGE
}

interactive=1
for arg in "$@"; do
  case $arg in
    -y | --yes | --defaults) interactive=0 ;;
    # Already read, in the pass that set up the palette.
    --color | --colour | --no-color | --no-colour) ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      printf '\n  %s✗%s  unknown option "%s"\n' "$red" "$reset" "$arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

# Questions need somewhere to ask. Without a terminal the script is being run
# by something rather than someone, and guessing on its behalf is worse than
# leaving the optional features at their documented defaults.
[ -t 0 ] || interactive=0

# ── Secrets ─────────────────────────────────────────────────────────────────

# Secrets, not world-readable.
umask 077

banner

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
  done_line 'Generated AUTH_SECRET'
  written=1
fi

if ! has_value POSTGRES_PASSWORD; then
  printf '\n# Database password. Applied when the cluster is first created.\nPOSTGRES_PASSWORD=%s\n' \
    "$(random_alnum 40)" >> "$env_file"
  done_line 'Generated POSTGRES_PASSWORD'
  written=1
fi

# ── Questions ───────────────────────────────────────────────────────────────

if [ "$interactive" -eq 1 ]; then
  for key in $question_keys; do
    has_value "$key" || questions_total=$((questions_total + 1))
  done

  # ── Where people reach it ─────────────────────────────────────────────────
  if ! has_value APP_URL; then
    question 'Public address'
    prose <<'TEXT'
The address people will type into a browser. Behind a reverse proxy
this is the public HTTPS URL, not the container port. Passkeys need
HTTPS everywhere except localhost.

TEXT
    while :; do
      ask_line 'Public URL' 'http://localhost:3000'
      app_url=$reply
      case $app_url in
        http://* | https://*) ;;
        *)
          oops 'Needs to start with http:// or https://.'
          continue
          ;;
      esac
      split_url "$app_url"
      if [ -z "$url_host" ]; then
        oops 'That URL has no host.'
        continue
      fi
      case $app_url in
        http://*)
          if ! is_localhost "$url_host"; then
            oops 'Browsers refuse passkeys on plain HTTP outside localhost, and'
            note '  Balancia refuses to start with that combination. Use https://,'
            note '  or localhost while you try it out.'
            continue
          fi
          ;;
      esac
      break
    done

    # Which host port Compose is going to bind. A localhost URL names it
    # itself — the browser talks straight to the published port — while behind
    # a proxy the URL says nothing about it and Compose's own default stands.
    if is_localhost "$url_host" && [ -n "$url_port" ]; then
      app_port=$url_port
    else
      app_port=3000
    fi

    # A port that is already held fails at `docker compose up` with "address
    # already in use", after the images have been built: a long way to come
    # for a number that could have been settled here. Asked rather than
    # chosen, because the operator may know what is on it — an earlier
    # instance of this app, say — and a port is theirs to pick.
    port_changed=0
    if port_taken "$app_port"; then
      printf '\n'
      oops "Something is already listening on port $app_port."
      note '  Compose would not be able to bind it. Another port here changes'
      note '  only where this host publishes the app.'
      printf '\n'
      suggested=$(suggest_port $((app_port + 1)) || :)
      while :; do
        # Kept out of $reply, which the next prompt overwrites.
        ask_line 'Host port' "$suggested"
        chosen=$reply
        if ! is_port "$chosen"; then
          oops 'Ports are whole numbers, 1 to 65535.'
          continue
        fi
        if ! port_taken "$chosen"; then
          app_port=$chosen
          break
        fi
        # Taken too — but the operator may be about to stop whatever holds
        # it, and only they can know that.
        oops "Port $chosen is taken as well."
        if ask_yes_no 'Use it anyway?' n; then
          app_port=$chosen
          break
        fi
      done
      port_changed=1
      # For a localhost URL the port is part of the address people type, so
      # the answer above moves the URL with it.
      if is_localhost "$url_host"; then
        app_url="$url_scheme://$url_host:$app_port$url_path"
      fi
    fi

    write_setting APP_URL "$app_url" \
      'The public URL people type. Must match exactly, scheme included.'

    # Compose publishes the app on ${APP_PORT:-3000}. Anything else has to be
    # written down: a localhost URL naming another port would otherwise point
    # at nothing.
    if [ "$app_port" != 3000 ]; then
      write_setting APP_PORT "$app_port" \
        'Host port Compose publishes the app on, matching APP_URL.'
    fi

    if [ "$port_changed" -eq 1 ]; then
      if is_localhost "$url_host"; then
        note "${dim}Balancia will be at ${app_url}.${reset}"
      else
        note "${dim}Compose will publish on port ${app_port}; point the proxy there.${reset}"
      fi
    elif [ "$app_port" != 3000 ]; then
      note "${dim}Compose will publish on port ${app_port} to match.${reset}"
    fi

    # Compose publishes the database as well, on ${DB_PORT:-5458}, and it
    # fails at `up` in the same way if that one is held — by a PostgreSQL
    # already running on this host, most often. Settled in the same breath as
    # the app's port rather than one build later. Nothing is written when 5458
    # is free: Compose's own default is the same number.
    if port_taken 5458; then
      printf '\n'
      oops 'Something is already listening on port 5458.'
      note '  Compose publishes the database there, for psql and other tooling'
      note '  on this host. Another port changes only where it is published.'
      printf '\n'
      suggested=$(suggest_port 5459 || :)
      while :; do
        ask_line 'Database port' "$suggested"
        chosen=$reply
        if ! is_port "$chosen"; then
          oops 'Ports are whole numbers, 1 to 65535.'
          continue
        fi
        if ! port_taken "$chosen"; then
          break
        fi
        oops "Port $chosen is taken as well."
        if ask_yes_no 'Use it anyway?' n; then
          break
        fi
      done
      write_setting DB_PORT "$chosen" \
        'Host port Compose publishes the database on. Prefix a bind address to keep it on this host: 127.0.0.1:5458'
      note "${dim}The database will be published on port ${chosen}.${reset}"
    fi
  fi

  # ── Registration ──────────────────────────────────────────────────────────
  if ! has_value ALLOW_REGISTRATION; then
    question 'Registration'
    prose <<'TEXT'
Anyone who can reach this instance may create an account. On a private
instance, close sign-ups once your own account exists.

TEXT
    if ask_yes_no 'Allow open registration?' y; then
      write_setting ALLOW_REGISTRATION true \
        'Open sign-ups. Set to false to close them on a private instance.'
    else
      write_setting ALLOW_REGISTRATION false \
        'Sign-ups closed. Set to true to reopen them.'
    fi
  fi

  # ── Demo ──────────────────────────────────────────────────────────────────
  # Asked, rather than left to the .env file, because the homepage stays silent
  # about a demo nobody configured — an operator who runs one would otherwise
  # never learn the link exists.
  if ! has_value DEMO_URL; then
    question 'Demo'
    prose <<'TEXT'
If you run a public demo of Balancia somewhere, its address goes here and
the homepage gains a "Try the demo" button beside "Create an account".

The demo itself is a separate deployment that keeps everything in memory
and stores nothing — see docs/demo.md. Leave this blank if you do not
run one; the button simply does not appear.

TEXT
    if ask_yes_no 'Do you run a demo of this instance?' n; then
      while :; do
        ask_line 'Demo address' 'https://demo.example.com'
        case $reply in
          http://* | https://*) break ;;
          *) note "${dim}Needs to be an absolute URL, starting http:// or https://.${reset}" ;;
        esac
      done
      write_setting DEMO_URL "$reply" \
        'Address of the public demo. The homepage links to it. Blank hides the link.'
    else
      write_setting DEMO_URL '' \
        'Address of a public demo, if you run one. Blank hides the homepage link.'
    fi
  fi

  # ── Exchange rates ────────────────────────────────────────────────────────
  if ! has_value EXCHANGE_RATE_PROVIDER; then
    question 'Exchange rates'
    prose <<'TEXT'
Groups that convert to one base currency can have the day's rate filled
in from the figures some eighty central banks publish, through
api.frankfurter.dev. No API key, 165 currencies. Rates are cached in
your database and can always be typed by hand; recorded rates are never
recalculated. This is the only routine outbound request Balancia makes.

TEXT
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
    question 'Receipt scanning'
    prose <<'TEXT'
Photograph a receipt and have it read into an expense — merchant, date,
line items and total — which you then correct and assign to people.
There are two ways to read one, and the next question asks which: on
the device holding the photo, or by this server through a provider you
configure. Whichever you pick, nothing is saved until someone confirms
it, and the split is computed the way every other expense's is.

TEXT
    if ask_yes_no 'Enable receipt scanning?' n; then
      write_setting RECEIPT_SCANNING true \
        'Receipt scanning on. The reader is chosen by the settings below.'
      choose_receipt_reader
    else
      write_setting RECEIPT_SCANNING false \
        'Receipt scanning off. See docs/receipt-scanning.md to turn it on.'
    fi
  fi

  # ── Semantic categorization ───────────────────────────────────────────────
  if ! has_value SEMANTIC_CATEGORIZATION; then
    question 'Semantic categorization'
    prose <<'TEXT'
Expense categories are suggested by rules that ship with Balancia, with
no configuration and no outbound requests. This adds a semantic
fallback for descriptions the rules do not cover, inferred in the
browser, so no transaction text leaves the device. Costs a ~150 MB
download now, and the same CSP relaxation as above.

TEXT
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
    question 'Push notifications'
    prose <<'TEXT'
Notifications appear inside the app either way. Push adds reaching a
device while Balancia is closed. The messages are relayed by the
browser vendor's push service (Google, Mozilla, Apple): payloads are
encrypted end to end so the relay cannot read them, but it does see
that a message reached a device.

TEXT
    if ask_yes_no 'Enable push notifications?' n; then
      # The same P-256 pair `pnpm push:keys` prints, generated by the same
      # code — the padding of a short scalar in src/lib/push/keys.ts is the
      # sort of detail a shell reimplementation would get wrong once in 256
      # keys.
      push_keys=$(run_ts scripts/generate-push-keys.ts 2> /dev/null || :)
      push_public=$(printf '%s\n' "$push_keys" | sed -n 's/^PUSH_VAPID_PUBLIC_KEY=//p')
      push_private=$(printf '%s\n' "$push_keys" | sed -n 's/^PUSH_VAPID_PRIVATE_KEY=//p')

      if [ -n "$push_public" ] && [ -n "$push_private" ]; then
        printf '\n'
        note "${green}✓${reset} Generated a VAPID key pair. Replacing it later makes"
        note '  every browser subscribe again, so keep it with your secrets.'
        printf '\n'
        # Handed to Google, Mozilla and Apple inside every VAPID token, so it is
        # asked for rather than guessed.
        while :; do
          ask_line 'Contact address for the push services' ''
          case $reply in
            '') oops 'Needed: the push services require a contact address.' ;;
            mailto:* | https://*)
              push_subject=$reply
              break
              ;;
            *@*.*)
              push_subject="mailto:$reply"
              break
              ;;
            *) oops 'Needs to be an email address, or a "mailto:"/"https://" URL.' ;;
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
    question 'Outgoing email'
    prose <<'TEXT'
Without SMTP, Balancia works fully but cannot verify an email address
or send a password-recovery link. Passkeys and passwords both work
without it.

TEXT
    if ask_yes_no 'Configure outgoing email?' n; then
      printf '\n'
      ask_line 'SMTP host' ''
      smtp_host=$reply
      if [ -z "$smtp_host" ]; then
        oops 'No host given — leaving email off. Run this again to set it up.'
      else
        # src/lib/env.ts coerces this to a number and rejects anything outside
        # 1–65535, which stops the app booting. Catch it while it can be retyped.
        while :; do
          ask_line 'SMTP port' '587'
          smtp_port=$reply
          case $smtp_port in
            '' | *[!0-9]*) oops 'Ports are digits, usually 587 or 465.' ;;
            *) break ;;
          esac
        done
        ask_line 'SMTP username, blank for none' ''
        smtp_user=$reply
        smtp_password=''
        if [ -n "$smtp_user" ]; then
          ask_secret 'SMTP password'
          smtp_password=$reply
        fi
        # Implicit TLS from the first byte, which is what port 465 expects.
        # Port 587 starts in the clear and upgrades with STARTTLS, which the
        # mailer does on its own.
        if ask_yes_no 'Connect with TLS immediately, usually port 465?' n; then
          smtp_secure=true
        else
          smtp_secure=false
        fi
        ask_line 'From address' "balancia@$smtp_host"
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

  # ── Telemetry ─────────────────────────────────────────────────────────────
  #
  # Two answers from one question: whether telemetry is permitted at all, and
  # where the switches start. They are asked together because they are one
  # decision to an operator — and because a second `if ! has_value` block would
  # be added to question_keys, counted up front, and then skipped whenever the
  # first answer is no. That is how the "N of M" counter goes wrong.
  #
  # It is asked at all because an operator who is never told the feature exists
  # cannot have decided anything about it, and because a switch reachable only
  # from an administration page is one most operators never find.
  if ! has_value TELEMETRY_MODE; then
    question 'Telemetry'
    prose <<'TEXT'
An administrator can turn on one anonymous report a week, from Settings
→ Administration → Telemetry, where the exact payload is shown before
anything is sent: the version, which features are on, and how much
happened in ranges rather than counts.

Amounts, names, group names, receipts, identifiers and this instance's
address are never in it, and there is nothing that identifies this
installation across reports. It can only ever reach
telemetry.balancia.app, which is compiled in rather than configurable.

The first question decides whether it is permitted at all — answer no to
remove the choice from the administration page for good. The second
decides where the switch starts, and an administrator can move it from
that page whenever they like.

TEXT
    if ask_yes_no 'Let an administrator turn telemetry on later?' y; then
      write_setting TELEMETRY_MODE opt-in \
        'What is permitted, not what is on. "local" records counters here and never sends; "off" forbids both.'
      if ask_yes_no 'Start with it switched on?' n; then
        write_setting TELEMETRY_DEFAULT true \
          'Both switches start on. The first time an administrator moves one, their answer replaces this for good.'
      else
        write_setting TELEMETRY_DEFAULT false \
          'Both switches start off, until an administrator turns them on in the application.'
      fi
    else
      write_setting TELEMETRY_MODE off \
        'No telemetry, whatever the administration page says. "opt-in" restores the choice.'
      # Written even though the mode already forbids everything, so that an
      # operator who later changes the mode to opt-in does not find that this
      # instance started reporting on its own.
      write_setting TELEMETRY_DEFAULT false \
        'Both switches start off. Moot while the mode above is off.'
    fi
  fi

  # ── Metrics ───────────────────────────────────────────────────────────────
  if ! has_value METRICS_ENABLED; then
    question 'Metrics'
    prose <<'TEXT'
Prometheus metrics at /api/metrics for your own monitoring: request and
job durations, error rates, database latency, memory and CPU. These are
exact and local — Balancia never transmits them, and the only way they
leave this server is a scraper you point at them.

The app's port is published, so a token is generated to protect them.

TEXT
    if ask_yes_no 'Expose Prometheus metrics?' n; then
      write_setting METRICS_ENABLED true \
        'Prometheus metrics at /api/metrics. Local only; nothing transmits them.'
      if ! has_value METRICS_TOKEN; then
        write_setting METRICS_TOKEN "$(random_alnum 48)" \
          'Bearer token for /api/metrics. Clear it only if the port is on a private network.'
      fi
    else
      write_setting METRICS_ENABLED false \
        'No metrics endpoint. Set to true to expose /api/metrics.'
    fi
  fi
fi

# ── Repairs ─────────────────────────────────────────────────────────────────

# A feature switched on whose model files are missing is the failure both
# docs/receipt-scanning.md and docs/categorization.md warn about: the browser
# renders no button and says nothing. Checked on every run, because the
# download may have failed after the flag was written.
if [ "$interactive" -eq 1 ]; then
  if is_enabled RECEIPT_SCANNING && is_enabled RECEIPT_OCR_LOCAL &&
    [ ! -e "$ocr_sentinel" ]; then
    heading 'Receipt scanning is on, but its models are missing'
    prose <<'TEXT'
RECEIPT_SCANNING is set, and there is nothing in public/models to read
a receipt with. Without the files the scan button never appears.

TEXT
    if ask_yes_no 'Install them now, ~32 MB?' y; then
      install_models scripts/fetch-ocr-model.ts OCR "$ocr_sentinel"
    fi
  fi

  if is_enabled SEMANTIC_CATEGORIZATION && [ ! -e "$semantic_sentinel" ]; then
    heading 'Semantic categorization is on, but its model is missing'
    prose <<'TEXT'
SEMANTIC_CATEGORIZATION is set, and there is nothing in public/models
to infer with. Without the files categorization uses its built-in rules.

TEXT
    if ask_yes_no 'Install it now, ~150 MB?' y; then
      install_models scripts/fetch-semantic-model.ts 'categorization' "$semantic_sentinel"
    fi
  fi

  # An instance set up before rates moved to Frankfurter v2 may still pin the
  # v1 root by hand. v1 is the ECB alone — thirty currencies — and the app now
  # refuses to start on it rather than answering every other currency with
  # silence. Offered as a repair because the alternative is a container that
  # restart-loops with the reason only in its logs.
  case $(value_of EXCHANGE_RATE_API_URL) in
    */v1 | */v1/)
      heading 'The exchange-rate URL still points at Frankfurter v1'
      prose <<'TEXT'
EXCHANGE_RATE_API_URL ends in /v1, which republishes the European
Central Bank alone: 30 currencies, and no rate for AED, UAH or the
130-odd others Balancia lets people pick. v2 blends some eighty central
banks and covers 165. Balancia will not start until this is changed.

TEXT
      if ask_yes_no 'Switch it to v2?' y; then
        write_setting EXCHANGE_RATE_API_URL 'https://api.frankfurter.dev/v2' \
          'Frankfurter v2 root, superseding the v1 line above: last one wins. v1 is refused at boot.'
      fi
      ;;
  esac

  # The two halves of "give the background jobs their own container" are a
  # Compose profile and an application setting, and nothing but this check ties
  # them together. Enabling the profile alone leaves the web process serving
  # the same queues as the worker — not corrupting, but not what was meant, and
  # the only sign of it is a line in the worker's log. Checked on every run,
  # because COMPOSE_PROFILES is edited by hand rather than answered above.
  case ,$(value_of COMPOSE_PROFILES), in
    *,worker,*)
      if is_enabled RUN_WORKER_IN_WEB || ! has_value RUN_WORKER_IN_WEB; then
        heading 'The worker container is on, and so is the web one'
        prose <<'TEXT'
COMPOSE_PROFILES names the worker service, so the background jobs get a
container of their own. The app container runs them as well unless told
not to, so both processes would subscribe to every queue. pg-boss hands
each job to one of them, so nothing breaks — but nothing is gained.

TEXT
        if ask_yes_no 'Leave the jobs to the worker container?' y; then
          write_setting RUN_WORKER_IN_WEB false \
            'The worker service runs the background jobs, so the web container must not.'
        fi
      fi
      ;;
    *)
      # The other half of the same mistake, and the damaging one: the setting
      # turned off with no worker service to take over. No recurring expense is
      # ever generated, no push is ever delivered, nothing is ever pruned, and
      # the app serves pages perfectly throughout.
      if has_value RUN_WORKER_IN_WEB && ! is_enabled RUN_WORKER_IN_WEB; then
        heading 'Nothing on this instance runs the background jobs'
        prose <<'TEXT'
RUN_WORKER_IN_WEB is off, which tells the app container that something
else is doing the work — and COMPOSE_PROFILES does not name the worker
service, so nothing is. Recurring expenses will not be generated, push
notifications will not be delivered and nothing will be pruned.

TEXT
        if ask_yes_no 'Run them in the app container?' y; then
          write_setting RUN_WORKER_IN_WEB true \
            'The app container runs the background jobs. Supersedes the line above: last one wins.'
        else
          note_pending "Nothing runs the background jobs on this instance.
Set COMPOSE_PROFILES=worker in .env to start the worker service,
or RUN_WORKER_IN_WEB=true to keep them in the app container."
        fi
      fi
      ;;
  esac

  # The one setting in this file that can make an instance's real data
  # unreachable. DEMO_MODE replaces the database with one held in memory, so an
  # operator who set it on the wrong stack sees an app that works perfectly and
  # has forgotten every account. Checked on every run, and not only when it was
  # answered above, because this is a line people paste in from docs/demo.md.
  if is_enabled DEMO_MODE; then
    heading 'This instance is configured as a demo'
    prose <<'TEXT'
DEMO_MODE is on. This container will not use PostgreSQL at all: it builds
the schema in memory at startup, hands each visitor a throwaway account
seeded with sample groups, and loses the lot when it restarts.

That is right for a public demo and wrong for anything else — if this is
the stack holding your real data, every account in it will be
unreachable until DEMO_MODE is off again. Nothing is deleted; the
database is simply not read.

TEXT
    if ask_yes_no 'Is this deployment meant to be a demo?' n; then
      note "${dim}Leaving DEMO_MODE on. See docs/demo.md.${reset}"
    else
      write_setting DEMO_MODE false \
        'Not a demo: use the real database. Supersedes the line above — last one wins.'
    fi
  fi

  # Metrics say nothing about anyone's money, but they do say how many people
  # use this instance and how much of it is failing, and the app's port is
  # published. The schema allows an empty token because a scrape target on a
  # private network has no use for one; it cannot tell which of the two this
  # is, so the question gets asked here instead. Checked on every run, because
  # METRICS_ENABLED is more often set by hand afterwards than answered above.
  if is_enabled METRICS_ENABLED && [ -z "$(value_of METRICS_TOKEN)" ]; then
    heading 'Metrics are exposed without a token'
    prose <<'TEXT'
METRICS_ENABLED is set and METRICS_TOKEN is empty, so anything that can
reach /api/metrics can read them: user and group counts, request rates,
error rates, memory. Leave it as it is only if that port is on a private
network your monitoring reaches and nothing else does.

TEXT
    if ask_yes_no 'Generate a token for it?' y; then
      write_setting METRICS_TOKEN "$(random_alnum 48)" \
        'Bearer token for /api/metrics. Clear it only if the port is on a private network.'
    fi
  fi
fi

chmod 600 "$env_file"

# ── Summary ─────────────────────────────────────────────────────────────────

# One line per feature, reading .env back rather than remembering what was
# answered: on a re-run most of it was decided by an earlier one, and the
# question this answers is "what is this instance going to do", not "what did
# you just type".
row() {
  _state=$2
  case $_state in
    off) _colour=$dim ;;
    *) _colour=$green ;;
  esac
  printf '    %-22s %s%s%s\n' "$1" "$_colour" "$_state" "$reset"
}

on_off() {
  if is_enabled "$1"; then printf 'on'; else printf 'off'; fi
}

# Which reader the summary reports, rather than a bare on/off — "on" stopped
# being the interesting fact the moment there were two ways to read a receipt.
receipt_reader_summary() {
  if ! is_enabled RECEIPT_SCANNING; then
    printf 'off'
    return
  fi

  _provider=$(value_of RECEIPT_OCR_PROVIDER)
  [ "$_provider" = none ] && _provider=''

  if is_enabled RECEIPT_OCR_LOCAL; then
    if [ -n "$_provider" ]; then
      printf 'on-device, or %s' "$_provider"
    else
      printf 'on-device'
    fi
  elif [ -n "$_provider" ]; then
    printf '%s' "$_provider"
  else
    # The schema refuses to boot in this state; say so rather than "on".
    printf 'on, but no reader configured'
  fi
}

# The mode is a ceiling and TELEMETRY_DEFAULT is where the switches start, so
# an honest line needs both. This used to be able to say "off" in every case,
# because nothing could be on before an administrator existed; with a default
# that no longer holds, and a summary that under-reported what an operator had
# just agreed to would be the worst line in the script.
telemetry_summary() {
  if is_enabled TELEMETRY_DEFAULT; then
    case $(value_of TELEMETRY_MODE) in
      off) printf 'off' ;;
      local) printf 'recorded here from first run, and nothing may be sent' ;;
      *) printf 'on from first run, an administrator may turn it off' ;;
    esac
  else
    case $(value_of TELEMETRY_MODE) in
      off) printf 'off' ;;
      local) printf 'off, and nothing may be sent' ;;
      # Empty too: the schema's default is opt-in, so an .env written by hand
      # without the line behaves the same way as one that answered yes.
      *) printf 'off, an administrator may enable' ;;
    esac
  fi
}

# Where recurring expenses, push delivery and the nightly sweep actually run.
# Worth a line because the answer is now a default rather than something that
# was typed, and because the state where nothing runs them — the profile off
# and the setting false — is silent everywhere else.
worker_summary() {
  case ,$(value_of COMPOSE_PROFILES), in
    # A missing line counts as on in both branches: the schema's default is
    # true, so an .env that says nothing behaves exactly like one that says so.
    # Reading it as off here is how this line would come to under-report the
    # very state the repair above exists to catch.
    *,worker,*)
      if has_value RUN_WORKER_IN_WEB && ! is_enabled RUN_WORKER_IN_WEB; then
        printf 'worker container'
      else
        printf 'worker container, and the app as well'
      fi
      ;;
    *)
      if has_value RUN_WORKER_IN_WEB && ! is_enabled RUN_WORKER_IN_WEB; then
        printf 'nothing runs them'
      else
        printf 'in the app container'
      fi
      ;;
  esac
}

summary() {
  printf '  %sThis instance%s\n\n' "$bold" "$reset"
  row 'Public address' "$(value_of APP_URL)"
  # Published on every interface unless the operator put a bind address in
  # front of the number, which is the difference worth reporting here.
  db_port=$(value_of DB_PORT)
  [ -n "$db_port" ] || db_port=5458
  case $db_port in
    *:*) row 'Database port' "$db_port, this host only" ;;
    *) row 'Database port' "$db_port, published" ;;
  esac
  if is_enabled ALLOW_REGISTRATION; then
    row 'Registration' 'open'
  else
    row 'Registration' 'closed'
  fi
  if is_enabled DEMO_MODE; then
    # Worth saying loudly rather than as a row: an operator seeing this on the
    # stack they meant to hold real data has a problem to fix.
    row 'Demo mode' 'ON — in memory, nothing is saved'
  elif [ -n "$(value_of DEMO_URL)" ]; then
    row 'Demo link' "$(value_of DEMO_URL)"
  fi
  case $(value_of EXCHANGE_RATE_PROVIDER) in
    frankfurter) row 'Exchange rates' 'frankfurter' ;;
    *) row 'Exchange rates' 'off' ;;
  esac
  row 'Receipt scanning' "$(receipt_reader_summary)"
  row 'Semantic categories' "$(on_off SEMANTIC_CATEGORIZATION)"
  if [ -n "$(value_of PUSH_VAPID_PUBLIC_KEY)" ]; then
    row 'Push notifications' 'on'
  else
    row 'Push notifications' 'off'
  fi
  if [ -n "$(value_of SMTP_HOST)" ]; then
    row 'Outgoing email' "$(value_of SMTP_HOST)"
  else
    row 'Outgoing email' 'off'
  fi
  row 'Background jobs' "$(worker_summary)"
  row 'Telemetry' "$(telemetry_summary)"
  if is_enabled METRICS_ENABLED; then
    if [ -n "$(value_of METRICS_TOKEN)" ]; then
      row 'Metrics' 'on, token required'
    else
      row 'Metrics' 'on, unprotected'
    fi
  else
    row 'Metrics' 'off'
  fi
}

# An empty APP_URL means nothing has been answered yet — an unattended run, or
# a --defaults one. There is nothing to summarise that the defaults do not
# already say.
summary_printed=0
if [ "$interactive" -eq 1 ] && [ -n "$(value_of APP_URL)" ]; then
  # The banner leaves a blank line behind it, so one is only needed here when
  # something else has printed since.
  if [ "$questions_asked" -gt 0 ] || [ "$written" -eq 1 ]; then
    printf '\n'
  fi
  summary
  summary_printed=1
fi

# The banner already leaves a blank line behind it, so a run that printed
# nothing in between — every answer present, nothing to generate — does not
# need another.
if [ "$written" -eq 1 ] || [ "$summary_printed" -eq 1 ]; then
  printf '\n'
fi

if [ "$written" -eq 0 ]; then
  done_line '.env already holds every answer — left untouched.'
elif [ "$created" -eq 1 ]; then
  done_line "Wrote .env. ${bold}Back it up${reset} — it is the only copy of these secrets."
else
  done_line "Updated .env. ${bold}Back it up${reset} — it is the only copy of these secrets."
fi

if [ -n "$pending" ]; then
  printf '\n  %sStill to do%s\n\n' "$bold" "$reset"
  printf '%s' "$pending"
fi

if [ "$interactive" -eq 0 ] && [ "$written" -eq 1 ]; then
  printf '  %s·%s  Optional features left at their defaults. Re-run in a\n' "$dim" "$reset"
  printf '     terminal to be asked about them.\n'
fi

printf '\n  Next  %sdocker compose up -d --build%s\n\n' "$cyan" "$reset"

exit 0
