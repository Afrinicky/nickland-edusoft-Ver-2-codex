// Nickland Edusoft — flipping the Electron fuses before the app is signed.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Fuses are bits inside the Electron binary that turn capabilities OFF for
// good. They are flipped at package time, BEFORE code signing, which is the
// whole point: flipping one back changes the binary, which breaks the
// signature, which makes Gatekeeper on macOS and SmartScreen on Windows refuse
// to run it. So the operating system, not our JavaScript, is what enforces
// these — and our JavaScript is the part an attacker can edit.
//
// This is the single most valuable anti-tamper measure available to an Electron
// application, and it is four lines of configuration.
//
// What each one closes:
//
//   EnableEmbeddedAsarIntegrityValidation
//     Electron checks app.asar against a hash baked into the binary. Edit one
//     line of our JavaScript and the application will not start.
//
//   OnlyLoadAppFromAsar
//     Without it, the above is trivially bypassed: Electron falls back to an
//     unpacked `app/` directory beside the asar, and an attacker unpacks the
//     asar, edits it, and deletes the asar. With it, there is no fallback.
//     These two are only worth having TOGETHER.
//
//   RunAsNode / EnableNodeCliInspectArguments / EnableNodeOptionsEnvironmentVariable
//     Each is a way to start our own binary as a plain Node process, or attach
//     a debugger to it, or inject a module before our code runs. Any one of
//     them turns the shipped Electron into a general-purpose tool for reading
//     and rewriting what the app does in memory — no file needs editing at all.
//
//   EnableCookieEncryption
//     Not anti-tamper; it encrypts the local cookie store at rest, and there is
//     no reason to leave it off.
//
// Run from `npm run build` (see package.json), after electron-builder has
// produced the unpacked app and before it signs.

import { flipFuses, FuseVersion, FuseV1Options } from '@electron/fuses';

/** @type {import('electron-builder').AfterPackContext} */
export default async function hardenElectron(context) {
  const { appOutDir, packager, electronPlatformName } = context;
  const name = packager.appInfo.productFilename;

  const binary = {
    darwin: `${appOutDir}/${name}.app/Contents/MacOS/${name}`,
    win32: `${appOutDir}/${name}.exe`,
    linux: `${appOutDir}/${name.toLowerCase()}`,
  }[electronPlatformName];

  if (!binary) {
    console.warn(`[fuses] no binary path known for ${electronPlatformName}; skipped`);
    return;
  }

  await flipFuses(binary, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: electronPlatformName === 'darwin',

    // ── The two that matter most, and only work as a pair ──
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,

    // ── Every way to run our binary as something other than our app ──
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,

    // ── Housekeeping ──
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
  });

  console.log(`[fuses] hardened ${electronPlatformName}: asar integrity on, `
    + 'asar-only loading on, RunAsNode/inspect/NODE_OPTIONS off');
}
