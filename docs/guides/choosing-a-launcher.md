# Choosing a launcher: signed web, pure-native or WebView

Couchroot has three launcher options. The table below compares the signed web
and pure-native options; the WebView option follows it. They share a purpose: a quiet, remote-first home screen
that opens your apps. They differ in how they reach the screen, what they need from
the TV, and how much of the feature set they carry.

| | Web Hub (`web/`) | Native Hub (`native-hub/`) |
| --- | --- | --- |
| Runs as | A signed Tizen web app (`MiniHub001.Hub`) | An unregistered EFL (Ecore/Evas) window, owner UID, read-only bind |
| Supported TVs | S90D (Tizen 9) and QN90A (Tizen 6) | **QN90A only** (firmware T-NKM2AKUC-2301.1) |
| Install path | Samsung developer signing + `./tv-setup` / `./deploy-ui` | Enrolled boot hook via `./couchroot-install`; requires the autonomous root agent (offline-tested backend) |
| Becomes Home by | Samsung's own Home/startup assignment (S90D) or the ISP source role (QN90A) | Boot hook dispatch + an overridable Home key grab |
| Software time to Hub after a QN90A reboot | ~37–47 s (best web path) | **~9–10 s** (first rendered frame) |
| Time to Hub on S90D | Samsung prelaunches Hub; AT-HUB helper supplies the splash handoff (visible/input-ready time unmeasured) | Not available |
| Features | Full: favourites, edit/move/undo, settings, sound, hold-OK, fade, telemetry, screensaver, monitoring | Core: favourites, edit/move/undo, settings, app discovery, Home routing; advanced web-only features stay in the web Hub |
| Failure fallback | Samsung Home | Web Hub (installed alongside) and Samsung Home |
| Maturity | Supported source release | Experimental research launcher |

## Native WebView: shared UI on the native boot path

The [WebView host](../../native/webview/README.md) loads the existing `web/`
interface in Chromium/EWK, started by the QN90A native boot hook. This preserves
the web editor and settings without maintaining a second drawing implementation.
The tested upgrade engine is Chromium 120; the default is Chromium 76.

It retains native boot admission, Home routing, source re-arm and app return,
adds bounded child restart, and imports old native preferences once into separate
WebView storage. Its native bridge exposes app discovery and launch, not the full
Tizen API. Telemetry, monitoring, screensaver and platform sound integration do
not automatically carry over. The signed web Hub remains installed as fallback.

The first deferred-presentation profile mapped a canvas at about 16.35 seconds,
but later frame capture showed that an early paint could contain only the page
background. The host now waits for Hub DOM/font readiness and a subsequent paint.
Two captured background software boots showed one Hub appearance with no white
frame or blackout afterward. Those initial trials needed early engine retries. A subsequent fix waits for
the base/upgrade filesystem contents before loading EWK; two further full boots
loaded Chromium 120 without retry and showed Hub content at about 17.3 seconds.
Thirteen later profiled software reboots put clean boots at 17–19.7 seconds. In
each, 4.4–5.2 seconds went to Samsung's wrapper loading the compressed Chromium
120 engine while boot work kept all four cores busy. No launcher change tried so
far reduced it. Two of those boots hit an intermittent Chromium abort during view
creation; firmware crash handling then delayed Hub content to about 41–43
seconds. Pure native has reached roughly 9–10 seconds.

Normal-mode handoff loaded the page around 37.3 seconds in an earlier owner test.
It waits for the signed Hub to retire the viewer and leaves that Hub visible while
the native window prepares offscreen. The latest captures do not validate that
remote-power normal-mode path or physical panel behavior. See the detailed
[evidence](../../native/webview/README.md#qn90a-evidence-2026-10-12).
Choose this experiment for the shared web interface, not an established speed or
memory improvement over pure native. Long-term stability and standby remain open.

Installation is still private and journaled, not a `./tv-setup` option. The public
source includes a first-boot recovery renderer and fault tests; see its README
for the execution-policy fix, acceptance checks and hardware validation limits.
S90D and other firmware have not been verified.

## Pick the web Hub when

- You have an S90D, or any TV other than a QN90A on firmware 2301.1.
- You want the supported, signed install that survives firmware-update review and
  uses only Samsung's normal app APIs.
- Your TV already starts its Home app itself. The S90D does: in one recorded restart
  `MiniHub001.Hub` produced its first logged event at 2.639 seconds after kernel
  boot: an upper bound on process creation, not a measured start or visibility
  time. A separate 2.26-second process-start sample belongs to a standby-wake
  session. S90D uses its own AT-HUB splash helper, not the QN90A boot hook.
- You need the web-only features (sound, hold-OK, fade, telemetry relay, saver).

The [2026-10-12 S90D assessment](../devices/s90d/native-boot-assessment.md)
recommends keeping web startup and measuring panel visibility and remote readiness
before changing the splash path. It does not establish a native boot-speed gain.

## Pick the native Hub when

The [native installer guide](native-installation.md) covers baseline enrollment,
installation and journaled recovery. The new backend has offline tests only;
historical native measurements below do not certify its hardware behavior.

- You have a QN90A on firmware 2301.1, and boot-to-Hub time matters. The web
  path on this model cannot start earlier than the firmware's app readiness, which
  arrives around 17–40 seconds into boot.
- You can run the autonomous root agent and accept an experimental boot hook,
  with the documented rollback.
- You want to avoid Live TV at boot. Pure-native admission requires the ISP/background
  boot mode, an empty foreground, the screen on, and a ready compositor. The
  WebView hook also handles normal-mode boot: it waits for the screen, opens
  the signed Hub to retire the TV viewer, then admits over that Hub. It still
  requires the correct ISP source/owner and compositor; another app cancels. If any
  check fails, native does not draw at all. This is not a quiet-boot guarantee: the
  firmware still starts Live TV whenever the saved source is not `isp-service` (see
  below), and picture and audio were not measured.

Keep the web Hub installed on a native-Hub TV. It remains the manual fallback,
behind the Web Hub button (Home toolbar or Settings), or a Home press while native's
Home grab is released, for example while its platform worker restarts. Back does not
open it: in native, Back returns from a utility page and does nothing on Home.
It also holds the ISP source role that the quiet boot depends on.

## Why the QN90A web path is slow and the native path is fast

On the QN90A, the web Hub can only launch after the firmware's web application
service and its boot readiness chain complete; a long vendor startup sequence runs first.
The native Hub is started directly from the earliest writable boot hook. It maps the
same EFL and Mali libraries that Live TV's viewer loads at about 1.3 s, so they are
probably already cached (inferred, not measured). That path had two hidden costs,
both addressed in 2026-10:

1. **Boot-time `SCHED_IDLE` demotion.** While a vendor boot-idle flag is set,
   Samsung's systemd starts services launched after `starter.target` loads (about
   7.3 s) at idle CPU priority. Static analysis shows that units setting
   `CPUSchedulingPolicy` skip this, among other exemptions; runtime profiling
   showed the native unit at policy 5 before the change. The native unit now sets
   `CPUSchedulingPolicy=other`, the same opt-out Samsung's own sensord,
   mbr-daemon and Bluetooth units use. It gets normal nice-0 scheduling, not elevated.
2. **Hook layering.** Experiments had stacked several hash-checked wrapper layers in
   front of the native dispatch. The dispatch now runs first; the other layers still
   run afterwards, in the same order.

See [QN90A boot performance](../devices/qn90a/boot-performance.md) for the
measurements, the evidence, and the remaining limits.

## The QN90A Live TV trap (both launchers)

The QN90A boots quietly only while its saved boot source is `isp-service`. Opening
Live TV or TV Plus immediately changes that saved source, so the next power-on
starts on Live TV. The native Hub now re-arms the source about every 15 s while it
runs, and routes Home from Live TV through the web Hub. This narrows the window; a
power-off before the next re-arm can still start one boot on Live TV. Details are in the
[native Hub README](../../native-hub/README.md#saved-source-re-arm-no-live-tv-after-watching-tv-2026-10-12).
