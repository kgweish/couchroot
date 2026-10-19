# Couchroot

**Your couch. Your TV. Your launcher.**

A quiet home screen for Samsung Tizen TVs, with optional telemetry and tools for
setup, administration and recovery. Built around the **QN90A** and **S90D**.

[Try it locally](#try-it-locally) · [TV setup](#put-it-on-a-tv) · [Documentation](docs/README.md) · [Release status](docs/project/release-readiness.md)

![Minimal Hub in compact mode, with a clock, app favorites and remote controls](docs/images/compact.png)

*Actual launcher UI in the local browser workbench. All screenshots use simulated
apps and contain no live device or account data.*

## Make yourself at home

- **A home screen you control.** Choose and reorder favorites, switch layouts,
  show a clock and adjust navigation sounds. Use arrows, OK and Back; Samsung
  Home remains one shortcut away.
- **Optional TV monitoring.** Basic health counters on QN90A; app, process and
  startup inspection on S90D. The launcher works without telemetry or a NAS.
- **Administration with recovery.** A separate experimental root agent provides
  authenticated commands, file transfers and jobs. Setup tools verify device
  identity and preserve backups and journals for interrupted operations.

<table>
  <tr>
    <td width="50%"><a href="docs/images/launcher.png"><img src="docs/images/launcher.png" alt="Comfortable layout with large app tiles and a visible remote focus ring"></a></td>
    <td width="50%"><a href="docs/images/settings.png"><img src="docs/images/settings.png" alt="Settings for navigation sounds, tile layout, clock and startup selection"></a></td>
  </tr>
  <tr>
    <td align="center"><strong>Room to browse</strong><br>Large tiles and clear remote focus.</td>
    <td align="center"><strong>Keep it yours</strong><br>Simple settings, directly on the TV.</td>
  </tr>
</table>

## Try it locally

You need **Node.js 20+ and npm**. No TV, signing certificate or root access is
required.

```sh
git clone https://github.com/splitcipher/couchroot.git
cd couchroot
npm ci
npm run dev
```

Open **<http://127.0.0.1:8766>**, choose a scenario and click the preview. Navigate
with the arrow keys, **Enter** for OK and **Escape** for Back. The workbench runs
the shipped web UI with simulated TV APIs; it does not contact a TV or NAS.

## Put it on a TV

Start with the [setup guide](docs/guides/tv-setup.md) and
[compatibility notes](docs/guides/device-compatibility.md). You provide Developer
Mode access, SDK tools and your own Samsung signing credentials. Private
configuration, keys and recovery journals stay outside Git.

| Launcher | Devices | Status |
| --- | --- | --- |
| **Signed web Hub** | QN90A, S90D | Default installation; full platform integration |
| **Pure-native Hub** | QN90A | Experimental C/EFL launcher |
| **Native WebView Hub** | QN90A | Experimental web UI in a native host |

[Compare launchers and boot measurements →](docs/guides/choosing-a-launcher.md)

The [S89C record](docs/devices/s89c/README.md) covers the scoped launcher and Home
trial on firmware 2220.4. General installation remains gated; standby and cold
reboot checks are pending.

The [command-line installer](docs/guides/universal-installer.md) can produce an
offline plan before any device access:

```sh
./couchroot-install plan --device qn90a --launcher web
```

`--launcher native` selects the pure-native Hub and requires an enrolled QN90A
baseline and root agent. Its new installation/recovery backend is locally tested;
hardware acceptance remains open. WebView has [separate tools](native/webview/README.md).
Keep the signed web Hub installed as the fallback for either native launcher.
For an existing setup, see [updating just the UI](docs/guides/ui-deployment.md).

## What's ready—and what's experimental

This is an **experimental source release for specific reviewed firmware profiles**.
Other models, regions and firmware versions are not covered by those results.

The native root worker has passed bounded trials on both TVs. It retains a small
.NET entry bridge and managed recovery fallback; complete .NET removal is deferred.
Clean boot, standby/power interruption and full endurance qualification remain
open for the current native version. The combined release candidate is locally
validated and has not been deployed to either TV.

QN90A basic native telemetry keeps the existing settings adapter and retires
continuous inspection. Its new installation flow still needs hardware acceptance;
S90D retains its existing collector and inspector.

See [release readiness](docs/project/release-readiness.md),
[telemetry and settings](docs/guides/telemetry.md), and
[root-agent operation and recovery](research/autonomous-root/README.md).
Read the recovery procedure before enabling the agent: a failed start with
Developer Mode pointing to loopback may require restoring computer access with
the TV remote.

## Develop and contribute

The UI lives in `web/`; `preview/` runs it locally. `tvsetup/` contains the shared
setup engine, and `research/` holds the agent and documented experiments.

```sh
npx playwright install chromium
npm test
npm run screenshots
```

[UI development](docs/guides/ui-development.md) covers preview scenarios and
remote-navigation checks. [Release validation](docs/project/release-readiness.md#validation-and-reproducibility)
covers setup, native and managed checks. .NET is needed for managed components
and full setup, not the browser preview. Follow [Contributing](CONTRIBUTING.md)
and [Security](SECURITY.md); keep device identifiers, credentials and raw logs
out of issues.

## License and credits

Original work is **[0BSD](LICENSE)**. Bundled third-party code retains its own
licenses; see [licensing details](LICENSE-STATUS.md).

Thanks to [Vetro](https://github.com/andrearicci93/vetro) and
[samsung-tv-root](https://github.com/chris-ritsen/samsung-tv-root) for the transport,
root payloads and research behind this work. [Sources & credits](CREDITS.md)
records the full provenance.

*Unofficial. Not endorsed or supported by Samsung. Product names and marks belong
to their respective owners.*
