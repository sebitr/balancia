// The two lines the homepage offers as the whole installation. One file is
// fetched and then run; it does the rest, including starting the stack, so
// there is deliberately no third command here.
//
// Kept beside the marketing components rather than in the docs because the
// card renders them verbatim — the notes under each line live in
// messages/*.json under marketing.selfHosting.install.steps, one per command.
export const INSTALL_COMMANDS = [
  "curl -fsSLO https://github.com/sebitr/balancia/releases/latest/download/bootstrap.sh",
  "sh bootstrap.sh",
] as const;
