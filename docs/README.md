# Documentation

Start with [Choosing a launcher](guides/choosing-a-launcher.md), then the
[setup guide](guides/tv-setup.md). Device records are dated lab notes: they state what
was measured on one firmware and keep failed experiments for reference.

## Guides

Set up, deploy, operate and develop.

- [Native WebView host and first-boot recovery](../native/webview/README.md)
- [Choosing a launcher: signed web, pure-native or WebView](guides/choosing-a-launcher.md)
- [UI design rules](guides/design-guidelines.md)
- [Device compatibility](guides/device-compatibility.md)
- [Edit apps — Minimal Hub 0.3.8](guides/edit-apps.md)
- [Owner-supervised hardware acceptance](guides/hardware-acceptance.md)
- [Minimal TV Hub](guides/owner-operations.md)
- [SDB connection reuse](guides/sdb-connection-reliability.md)
- [Shared Samsung TV monitoring](guides/telemetry.md)
- [QN90A native telemetry: local integration candidate](guides/native-telemetry.md)
- [TV setup and reapplication (unreleased)](guides/tv-setup.md)
- [Deploy the Hub UI](guides/ui-deployment.md)
- [UI development](guides/ui-development.md)

## QN90A (Tizen 6, 2021)

Model-specific integration, boot and cleanup records.

- [QN90A port and rollback](devices/qn90a/README.md)
- [QN90A optional-app cleanup](devices/qn90a/app-cleanup.md)
- [QN90A boot performance: from ~118 s to ~10 s](devices/qn90a/boot-performance.md)
- [QN90A return after AirPlay mirroring](devices/qn90a/casting.md)
- [Why Mini Hub did not replace Live TV at cold boot](devices/qn90a/direct-boot.md)
- [QN90A Home key routing](devices/qn90a/home.md)
- [QN90A one-time memory cleanup](devices/qn90a/overhead.md)
- [QN90A package-image startup investigation](devices/qn90a/package-images.md)
- [QN90A navigation performance](devices/qn90a/performance.md)
- [QN90A startup audit — 2026-09-22](devices/qn90a/startup-audit.md)
- [QN90A startup-disable comparisons — 2026-09-22](devices/qn90a/startup-disable-tests.md)
- [QN90A startup launch diagnostics — 2026-09-22](devices/qn90a/startup-launch-diagnostics.md)
- [QN90A viewer suppression trial](devices/qn90a/suppression-trial.md)
- [QN90A TV-viewer background startup investigation](devices/qn90a/viewer-background.md)
- [QN90A web startup profiling — 2026-09-22](devices/qn90a/web-startup.md)

## S90D (Tizen 9, 2024)

Model-specific integration, telemetry and cleanup records.

- [Samsung S90D minimal hub integration](devices/s90d/README.md)
- [S90D optional-app cleanup](devices/s90d/app-cleanup.md)
- [S90D boot-to-dashboard inventory design](devices/s90d/boot-inventory.md)
- [Samsung S90D memory trimming](devices/s90d/overhead.md)
- [Samsung S90D on-demand root after reboot](devices/s90d/persistence.md)
- [S90D boot-splash acknowledgement investigation](devices/s90d/splash-acknowledgement.md)
- [S90D telemetry to TrueNAS Netdata](devices/s90d/telemetry.md)

## Research

Platform investigations, including failed approaches.

- [Verified temporary root chain](research/exploit-chain.md)
- [HDMI shortcuts investigation](research/hdmi-shortcuts.md)
- [Minimal Hub hardware validation — 2026-09-22](research/hub-hardware-validation-20260922.md)
- [Samsung launch spinner — native suppression in 0.3.8](research/launch-spinner.md)
- [Native startup and restart](research/native-autostart.md)
- [Native collector supervision](research/native-service-research.md)
- [Native Netdata feasibility](research/netdata-native.md)
- [Tizen 6 startup research: ranked points of interest](research/tizen6-survey.md)

## Project

Release and publication records.

- [QN90A home-use scope and remaining acceptance](project/dotnet-deprecation-plan.md)
- [QN90A cleanup tracker — 2026-10-19](project/qn90a-cleanup-plan.md)
- [Source publication review — 2026-10-11](project/publication-review.md)
- [Current publication scope — 2026-10-11](project/release-readiness.md)
