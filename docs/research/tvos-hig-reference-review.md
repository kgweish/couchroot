# tvOS design reference review

Reviewed 2026-10-19 for the S89C Hub on local branch
`codex/tvos-hig-design`, based on fork `main` at `8a7221e`.

This records source findings for the owner's selected Horizon Dock design.
The approved revision places Samsung Home above the dock at the left, with
separate Edit apps and Settings controls after the final app row.
The existing Hub provides the app inventory, saved
shortcuts, live TV and HDMI actions, settings, and Samsung Home escape.

## Reference and coverage

The entry point is Apple's [Designing for tvOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-tvos).
The review followed its remote, game-controller, Siri, video, SharePlay,
Top Shelf and TV-provider links. It also followed the design topics relevant to
the Hub's grid, settings, picker and editing flows. The source index below
contains 45 HIG topics; Apple-platform integrations and unrelated platform
sections were checked for applicability.

The [Apple TV Home guide](https://support.apple.com/guide/tv/rearrange-apps-on-the-home-screen-atvbad14dc6a/tvos)
provides the device Home reference. Its [source image](https://help.apple.com/assets/6A0B92AC55AFD81B2E01CA2A/6A0B92B055AFD81B2E01CA30/en_US/03727af2dd49e1909b594da78de277e5.png)
shows a translucent dock over full-screen artwork, a raised focused icon,
a clock capsule and part of the next row. These are observations of that
Home state. Apple's [Appearance settings](https://support.apple.com/guide/tv/change-appearance-settings-atvb46af4f11/tvos)
explicitly offers five icons across with the Large setting, supporting the
owner's existing choice.

Additional resources reviewed: [Apple Design Resources](https://developer.apple.com/design/resources/#tvos-apps),
[tvOS Pathway](https://developer.apple.com/tvos/get-started/) and the transcript of
[Build SwiftUI apps for tvOS](https://developer.apple.com/videos/play/wwdc2020/10042/).
The 2020 session explains focus, context menus and shelves. Current HIG and
Home references supply the newer visual treatment.

## Published measurements

| Topic | Apple measurement | Meaning for a 1920×1080 Hub composition |
| --- | --- | --- |
| [Layout](https://developer.apple.com/design/human-interface-guidelines/layout#tvOS) | 80 pt side insets; 60 pt top and bottom | Keep important controls within the safe region; photos can fill the screen. |
| Five-column layout | 320 pt unfocused width; 40 pt horizontal gap; at least 100 pt vertical spacing | Five widths and four gaps occupy 1760 pt. Labels and focus growth need room. |
| [App icons](https://developer.apple.com/design/human-interface-guidelines/app-icons) | 800×480 px canvas | 5:3 artwork; a 320-wide tile has a derived height of 192. |
| [Typography](https://developer.apple.com/design/human-interface-guidelines/typography#tvOS-built-in-text-styles) | Body 29/36 pt; Caption 1 25/32; Caption 2 23/30 | Use comparable size and leading with a font available on Samsung. |
| [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) | tvOS text defaults to 29 pt with a 23 pt minimum; controls default to 66×66 pt with a 56×56 minimum | Check captions and small utility controls from the viewing position. |
| [Images](https://developer.apple.com/design/human-interface-guidelines/images#Layered-images) | Two to five layers, with an opaque background layer | Layered artwork explains Apple's depth effect; preserve logo padding during focus growth. |

Mapping tvOS points onto the Hub's 1080p logical stage is a design choice that
needs inspection in Tizen. Apple publishes no universal Home corner radius,
focus scale, shadow blur or animation duration in these pages. Any chosen
values require comparison with the reference and calibration on the S89C.

## Interaction findings

| Existing flow | Source finding | Consequence for this Hub |
| --- | --- | --- |
| App and input grid | [UIKit focus](https://developer.apple.com/documentation/uikit/adding-user-focusable-elements-to-a-tvos-app) moves toward an eligible neighbor and retains focus at empty edges. | Keep one visible focus target with predictable directional movement. |
| Launch | [Focus and selection](https://developer.apple.com/design/human-interface-guidelines/focus-and-selection) separates focus from activation. | OK invokes the existing action; background and clock updates preserve the focused item. |
| Return and dismissal | [Remotes](https://developer.apple.com/design/human-interface-guidelines/remotes) describes parent-based Back. | Preserve existing dismissal and cancellation, focus restoration and Samsung Home behavior. |
| Editing | [Context menus](https://developer.apple.com/design/human-interface-guidelines/context-menus) keeps context actions discoverable through the main UI. | Keep Edit apps visible; preserve the existing held-OK route. |
| Settings | [Settings](https://developer.apple.com/design/human-interface-guidelines/settings) places general preferences and local editing in their relevant contexts. | Retain saved preference keys, defaults chosen by the owner and reset confirmation. |
| Materials | [Materials](https://developer.apple.com/design/human-interface-guidelines/materials) includes glass on focused tvOS buttons and image views. | Use restrained translucency with sufficient contrast over every landscape. |
| Accessibility | [Motion](https://developer.apple.com/design/human-interface-guidelines/motion) and accessibility guidance support reduced movement. | Preserve a static focus cue when motion is reduced; give every actionable tile an accessible name. |

## Samsung boundaries

Top Shelf provides the visual relationship between a dock and background.
The Hub's landscapes can supply passive artwork. Cross-service viewing
history and playback previews require real data and integration, so the
concepts use the existing launcher content.

Siri, SharePlay, TV-provider authentication and Apple TV app integration depend
on Apple facilities. The same applies to native focus effects and Liquid Glass.
The Samsung renderer needs its own visual treatment. Ornaments and immersive
experiences are marked unsupported on tvOS and serve other Apple platforms.
Service sign-in remains within each installed service.

The implementation uses the shared `web/` source and `preview/` workbench.
Changes to geometry also reach directional-navigation checks and screenshots;
new shipped assets reach `tvsetup/planner.py::hub_sources`. Preserve older
browser fallbacks and the S89C's existing native bridge. This review changes
documentation only.

Actual TV checks remain for glass rendering cost, legibility across photo
changes, repeated arrows, focus after returning from an app, and Back through
editing and settings. Generated concepts are still images and establish no
runtime or hardware result.

## HIG source index

| Area | Reviewed pages |
| --- | --- |
| Platform entry and inputs | [Designing for tvOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-tvos), [Remotes](https://developer.apple.com/design/human-interface-guidelines/remotes), [Game controls](https://developer.apple.com/design/human-interface-guidelines/game-controls), [Siri](https://developer.apple.com/design/human-interface-guidelines/siri), [Gestures](https://developer.apple.com/design/human-interface-guidelines/gestures), [Keyboards](https://developer.apple.com/design/human-interface-guidelines/keyboards) |
| Focus and access | [Focus and selection](https://developer.apple.com/design/human-interface-guidelines/focus-and-selection), [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility), [VoiceOver](https://developer.apple.com/design/human-interface-guidelines/voiceover), [Motion](https://developer.apple.com/design/human-interface-guidelines/motion), [Feedback](https://developer.apple.com/design/human-interface-guidelines/feedback) |
| Visual foundations | [Layout](https://developer.apple.com/design/human-interface-guidelines/layout), [Typography](https://developer.apple.com/design/human-interface-guidelines/typography), [Color](https://developer.apple.com/design/human-interface-guidelines/color), [Materials](https://developer.apple.com/design/human-interface-guidelines/materials), [Images](https://developer.apple.com/design/human-interface-guidelines/images), [App icons](https://developer.apple.com/design/human-interface-guidelines/app-icons), [Icons](https://developer.apple.com/design/human-interface-guidelines/icons), [SF Symbols](https://developer.apple.com/design/human-interface-guidelines/sf-symbols) |
| Navigation and controls | [Navigation and search](https://developer.apple.com/design/human-interface-guidelines/navigation-and-search), [Collections](https://developer.apple.com/design/human-interface-guidelines/collections), [Scroll views](https://developer.apple.com/design/human-interface-guidelines/scroll-views), [Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars), [Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars), [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons), [Labels](https://developer.apple.com/design/human-interface-guidelines/labels), [Toggles](https://developer.apple.com/design/human-interface-guidelines/toggles), [Sliders](https://developer.apple.com/design/human-interface-guidelines/sliders), [Settings](https://developer.apple.com/design/human-interface-guidelines/settings) |
| Menus and modal tasks | [Menus](https://developer.apple.com/design/human-interface-guidelines/menus), [Context menus](https://developer.apple.com/design/human-interface-guidelines/context-menus), [Action sheets](https://developer.apple.com/design/human-interface-guidelines/action-sheets), [Alerts](https://developer.apple.com/design/human-interface-guidelines/alerts), [Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets), [Modality](https://developer.apple.com/design/human-interface-guidelines/modality) |
| Entry and accounts | [Onboarding](https://developer.apple.com/design/human-interface-guidelines/onboarding), [Managing accounts](https://developer.apple.com/design/human-interface-guidelines/managing-accounts#TV-provider-accounts), [Sign in with Apple](https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple), [Apple In-App Purchase](https://developer.apple.com/design/human-interface-guidelines/apple-in-app-purchase) |
| Media and linked platform topics | [Playing video](https://developer.apple.com/design/human-interface-guidelines/playing-video#Integrating-with-the-TV-app), [Playing audio](https://developer.apple.com/design/human-interface-guidelines/playing-audio), [SharePlay](https://developer.apple.com/design/human-interface-guidelines/shareplay), [Top Shelf](https://developer.apple.com/design/human-interface-guidelines/top-shelf), [Ornaments](https://developer.apple.com/design/human-interface-guidelines/ornaments), [Immersive experiences](https://developer.apple.com/design/human-interface-guidelines/immersive-experiences) |

Additional focus references: [About focus interactions](https://developer.apple.com/documentation/uikit/about-focus-interactions-for-apple-tv),
[Focus-based navigation](https://developer.apple.com/documentation/uikit/focus-based-navigation)
and [Preferred focus environments](https://developer.apple.com/documentation/uikit/uifocusenvironment/preferredfocusenvironments).
Apple source pages and reference screenshots remain outside the repository;
this document contains original synthesis and source links.
