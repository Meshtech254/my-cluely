# Third-party notices

OpenCluely is distributed under the Apache License, Version 2.0. The following
third-party components are included in or used by the application. Their
copyright and license terms remain applicable to those components.

## Direct npm dependencies

| Component | License | Notice/source |
|---|---|---|
| `@fortawesome/fontawesome-free` 7.2.x | MIT (code), CC BY 4.0 (icons), SIL OFL 1.1 (fonts) | https://fontawesome.com/license/free |
| `@google/genai` 2.9.x | Apache-2.0 | https://github.com/googleapis/js-genai |
| `dotenv` 16.x | BSD-2-Clause | https://github.com/motdotla/dotenv |
| `markdown` 0.5.0 | MIT (copyright notices are retained in the vendored copy) | `lib/markdown.js` |
| `marked` 15.x | MIT | https://github.com/markedjs/marked |
| `microsoft-cognitiveservices-speech-sdk` 1.x | MIT | https://github.com/microsoft/cognitive-services-speech-sdk-js |
| `node-record-lpcm16` 1.x | ISC | https://github.com/JamesKyburz/node-record-lpcm16 |
| `prismjs` 1.x | MIT | https://github.com/PrismJS/prism |
| `winston` 3.x | MIT | https://github.com/winstonjs/winston |
| `winston-daily-rotate-file` 4.x | MIT | https://github.com/winstonjs/winston-daily-rotate-file |
| `electron` 29.x | MIT | https://github.com/electron/electron |
| `electron-builder` 24.x | MIT | https://github.com/electron-userland/electron-builder |

The lockfile includes transitive packages under MIT, ISC, Apache-2.0,
BSD-2-Clause, BSD-3-Clause, BlueOak-1.0.0, CC0-1.0, Python-2.0, WTFPL, OFL-1.1,
and CC BY 4.0. Preserve each package's own license and copyright files when
redistributing the packaged application. Generate a version-specific complete
inventory from `package-lock.json` for each release.

## Vendored assets and optional downloads

- Font Awesome's bundled CSS, icon assets, and webfonts retain the upstream
  licensing notice in `assests/vendor/fontawesome/all.min.css`.
- `lib/markdown.js` retains its upstream copyright headers.
- Optional local speech setup installs OpenAI Whisper and Python dependencies
  at runtime and downloads model weights. Those packages and weights are not
  part of the npm lockfile and must be inventoried for any redistribution or
  bundled offline installer.

This inventory is a release aid, not a substitute for checking the licenses
of the exact dependency and model artifacts shipped in each build.
