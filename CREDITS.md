# Sources & Credits

Couchroot grew out of hands-on QN90A/S90D development and the work below.
Thank you to the authors and maintainers who made their implementations and
research available. Inclusion here does not imply their endorsement.

## Code included in this repository

| Source | Contribution | License / provenance |
| --- | --- | --- |
| [Andrea Ricci's Vetro](https://github.com/andrearicci93/vetro) | SDB/ADB transport, root-agent protocol and tar modules used by the autonomous service; its TV-local loopback approach informed our startup experiments. | MIT; [retained notice](research/autonomous-root/service/vendor/LICENSE), [pinned revision and hashes](research/autonomous-root/UPSTREAM.json) |
| [chris-ritsen/samsung-tv-root](https://github.com/chris-ritsen/samsung-tv-root) | Archive-root and root-worker C# payloads, obtained through the pinned Vetro source tree and built locally for each TV runtime. Earlier host-root work also used this project's research. | [Unlicense](research/autonomous-root/payload/LICENSE); [payload provenance](research/autonomous-root/UPSTREAM.json) |

The protocol regression checks in `tests/autonomous-root/protocol.test.cjs`
are also adapted from Vetro and retain its MIT attribution.

Our service lifecycle, certificate-pinned administration API, setup integration,
model-specific guards and recovery tests are documented in the
[autonomous agent notes](research/autonomous-root/README.md). They should not be
attributed wholesale to upstream, nor should our hardware observations be taken
as upstream compatibility claims.

## Development and research references

- [Samsung Smart TV developer documentation](https://developer.samsung.com/smarttv/):
  application testing, signing, Tizen .NET, product APIs and screensaver behavior.
- [Tizen platform source](https://git.tizen.org/cgit/): security-manager mount
  namespaces, AMD boot lifecycle and app-installer signature/trust handling.
  Exact source revisions and the conclusions drawn from them are linked in the
  [Tizen 6 research survey](docs/research/tizen6-survey.md).
- [reisxd/TizenTube](https://github.com/reisxd/TizenTube): service manifest and
  deployment references in that survey; a reference, not a bundled application.
- [flutter-tizen](https://github.com/flutter-tizen/flutter-tizen): TV host/runtime
  constraints considered during native-service research.
- [mmajchr/SamsungKernelSecurity](https://github.com/mmajchr/SamsungKernelSecurity):
  UEP implementation reference in the [native-service investigation](docs/research/native-service-research.md).
- [systemd](https://github.com/systemd/systemd): transient-unit lifecycle reference
  in the same investigation.

Research notes retain their source links and pinned revisions where recorded.
Public platform source is a reference, not proof that a specific TV firmware
behaves identically. Firmware bodies and private device captures are excluded.

## Development tools

The launcher and workbench's service artwork is credited in [the logo source notes](web/logos/README.md).
These marks retain their owners' rights.

The local workflow uses Node.js, Python/lxml, Playwright/Chromium, .NET and
Emscripten. Dependency versions are recorded in `package-lock.json`,
`tvsetup/requirements.txt`, `global.json` and the build workflow. These projects
retain their own licenses. Codex assisted with implementation, investigation,
testing and documentation; hardware observations are identified separately.
