// FILE: normalize.js
// Purpose: Shared normalization helpers used across the bridge.
// Layer: Bridge shared utility
// Exports: readString, readStringOrNull
// Depends on: (none)

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function readStringOrNull(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

module.exports = { readString, readStringOrNull };
