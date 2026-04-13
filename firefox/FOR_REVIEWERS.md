# Build Instructions for Mozilla Reviewers

## Overview

This extension is written in TypeScript and bundled into a single file
(`dist/background.js`) using [esbuild](https://esbuild.github.io/). The source
files in `src/` correspond directly to the bundled output — there is no
minification, no obfuscation, and no code generation. Variable names and
structure are preserved as-written.

## Operating system

Any: macOS, Linux, or Windows. The build process is platform-independent.

## Build environment requirements

| Program | Required version | Installation |
|---|---|---|
| Node.js | 18.0.0 or later | Download from https://nodejs.org/ or use a version manager such as [nvm](https://github.com/nvm-sh/nvm) |
| npm | 9.0.0 or later | Included with Node.js — no separate installation needed |

To verify your versions after installation:

```sh
node --version   # should print v18.x.x or higher
npm --version    # should print 9.x.x or higher
```

## Build script

A single script performs all necessary steps — installing dependencies and
producing the final `dist/background.js`:

```sh
npm install && npm run build
```

- `npm install` fetches all dependencies from the npm registry using the exact
  versions pinned in `package-lock.json`.
- `npm run build` invokes esbuild via `build.ts` to bundle
  `src/background.ts` and its imports into `dist/background.js`.

The resulting `dist/background.js` is the file included in the submitted `.xpi`.

## Step-by-step instructions

1. Ensure Node.js 18+ and npm 9+ are installed (see requirements above).
2. Extract the contents of this source zip into a directory.
3. Open a terminal in that directory.
4. Run:
   ```sh
   npm install
   npm run build
   ```
5. Inspect `dist/background.js` — this is the bundled extension background
   script. It is human-readable; no minification is applied.

## Source file map

| Source file | Purpose |
|---|---|
| `src/background.ts` | Main extension logic — detects 402 responses, constructs payments, injects headers |
| `src/payment-handler.ts` | Constructs the BRC-0121 BSV payment transaction via the local wallet |
| `src/types.ts` | Shared TypeScript interfaces |
| `build.ts` | esbuild configuration (entry point, output format, target) |
| `manifest.json` | Extension manifest |

## Dependencies

All dependencies are open source and fetched from the npm registry.
Exact versions are pinned in `package-lock.json`.

| Package | Version | Purpose |
|---|---|---|
| `@bsv/402-pay` | `^0.1.3` | BRC-0121 client — constructs payment headers |
| `@bsv/sdk` | `^2.0.13` | BSV SDK — cryptographic primitives for transaction construction |
| `esbuild` | `^0.25.0` | Build tool — bundles TypeScript to a single JS file |
| `tsx` | `^4.19.0` | Runs the TypeScript build script directly |
| `typescript` | `^5.5.0` | Type checking |

## Notes

- No minification is applied. The `minify: false` flag is set explicitly in
  `build.ts`. The bundled output is human-readable.
- Source maps are generated (`dist/background.js.map`) for debugging but are
  not included in the `.xpi`.
- The bundle format is `iife` (immediately-invoked function expression),
  which is standard for browser extension background scripts.
