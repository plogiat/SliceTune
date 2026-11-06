# Third-party components

SliceTune source code is licensed under GPL-3.0-only; see LICENSE.

| Component | License | Source |
| --- | --- | --- |
| Electron | MIT; Chromium includes additional licenses | https://github.com/electron/electron |
| Lucide | ISC | https://github.com/lucide-icons/lucide |
| SoundTouchJS | LGPL-2.1 | https://github.com/cutterbl/SoundTouchJS |
| SoundTouch algorithm | LGPL-2.1 | https://www.surina.net/soundtouch/ |
| @ffmpeg-installer/ffmpeg | LGPL-2.1 wrapper; the bundled FFmpeg build is GPL | https://github.com/kribblo/node-ffmpeg-installer |
| FFmpeg | GPL-3.0-or-later for the GPL-enabled binaries used here | https://ffmpeg.org / https://github.com/FFmpeg/FFmpeg |
| Vite (build only) | MIT | https://github.com/vitejs/vite |

FFmpeg is executed as a separate program. The platform-specific npm package retains its README with the build distributor and source information. Inspect `node_modules/@ffmpeg-installer/<platform>/README.md` and the binary's `-version` output for the exact platform build and build configuration. Linux and Windows package builds may differ. No verification, license notices or dependency files should be stripped when redistributing.

Electron's LICENSE and LICENSES.chromium.html accompany packaged builds. npm dependencies retain their individual license files. The complete SliceTune source, including modifications and build instructions, is available in this repository under the corresponding release tag.

SliceTune's experimental vocal correction is independent of Antares Auto-Tune. No Antares software, models or trademarks are bundled.
