export const INSTALL_COMMANDS = [
  "git clone https://github.com/sebitr/balancia.git && cd balancia",
  "./scripts/bootstrap.sh",
  "docker compose up -d",
] as const;
