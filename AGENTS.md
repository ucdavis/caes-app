# Agent Instructions

- Node/npm commands may run inside the Codex sandbox by default.
- Run Node/npm commands outside the Codex sandbox when they spawn nested npm package installation or npm exec flows, such as packed tarball smoke tests that run `npm install`, `npm exec`, or npx-style verification from inside another npm script. The sandbox can hang on those nested npm flows even when the same command succeeds outside the sandbox.
