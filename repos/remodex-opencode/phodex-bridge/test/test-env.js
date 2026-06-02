// FILE: test-env.js
// Purpose: Default test process env so unit tests do not spawn live OpenCode serve.
// Layer: Test harness preload (node -r ./test/test-env.js --test)
// Exports: none (side effects only)

if (!process.env.REMODEX_TEST) {
  process.env.REMODEX_TEST = "1";
}

// Tests that explicitly unset this flag opt into live OpenCode behavior.
if (!process.env.REMODEX_DISABLE_OPENCODE) {
  process.env.REMODEX_DISABLE_OPENCODE = "1";
}