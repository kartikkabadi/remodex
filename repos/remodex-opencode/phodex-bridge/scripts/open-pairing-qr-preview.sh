#!/usr/bin/env bash
# Renders ~/.remodex/pairing-session.json as a PNG and opens it in Preview.
set -euo pipefail

PAIRING_FILE="${HOME}/.remodex/pairing-session.json"
OUT="/tmp/remodex-pairing-qr.png"
QR_DEPS="/tmp/remodex-qr/node_modules/qrcode"

if [[ ! -f "${PAIRING_FILE}" ]]; then
  echo "Missing ${PAIRING_FILE}. Start ./run-local-remodex.sh first." >&2
  exit 1
fi

if [[ ! -d "${QR_DEPS}" ]]; then
  mkdir -p /tmp/remodex-qr
  printf '%s\n' '{"name":"remodex-qr","private":true}' > /tmp/remodex-qr/package.json
  (cd /tmp/remodex-qr && sfw npm install qrcode@1.5.4 --no-save >/dev/null)
fi

node - "${OUT}" "${QR_DEPS}" <<'NODE'
const fs = require("fs");
const path = require("path");
const QRCode = require(process.argv[3]);
const out = process.argv[2];
const session = JSON.parse(fs.readFileSync(path.join(process.env.HOME, ".remodex/pairing-session.json"), "utf8"));
const payload = JSON.stringify(session.pairingPayload);
QRCode.toFile(out, payload, { width: 512, margin: 2 }, (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  const code = session.pairingCode || "";
  console.log(`QR: ${out}`);
  if (code) {
    console.log(`Pairing code: ${code}`);
  }
});
NODE

open -a Preview "${OUT}"
