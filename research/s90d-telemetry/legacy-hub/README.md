# Legacy Hub monitoring adapters

These adapters preserve the existing S90D and QN90A collectors. Their model
builders inject the scripts in dependency order and set the configured device ID.
The core launcher and S89C build exclude them. Launcher Settings no longer
exposes monitoring controls; existing receiver/service operations remain in
[the monitoring guide](../../../docs/guides/telemetry.md).
