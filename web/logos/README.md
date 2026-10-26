# Service artwork for the S89C Home design

Retrieved on 2026-10-18 from the services' public sites and publisher resources.
These files identify services in the S89C launcher and local workbench. Copyright and trademark
rights remain with their respective owners; the project's 0BSD grant applies to
original project work. Inclusion implies no endorsement.

| Service | Local file | Source |
| --- | --- | --- |
| Plex | `plex.svg` | [Plex's public site](https://watch.plex.tv/), header SVG |
| YouTube | `youtube.svg` | [YouTube Brand Resources](https://brand.youtube/), full-logo SVG in the site's public component bundle |
| Netflix | `netflix.png` | [Netflix Company Assets](https://about.netflix.com/en/company-assets), `Netflix_Logo.zip` → `01_Netflix_Logo/01_Netflix_Logo_RGB/Netflix_Logo_RGB.png` |
| Prime Video | `prime.png` | [Prime Video](https://www.primevideo.com/), `pv_logo_white._CB548637580_.png` served by Amazon's media CDN |
| Disney+ | `disney.png` | [Disney+ Logo 2024](https://press.disneyplus.com/about/disney-plus-logo-2024), official transparent black wordmark `a8e5567d1658de062d95d079ebf536b0_4096x2309_6dedcc02.png`, inverted to white through CSS |
| Hulu | `hulu.svg` | [Hulu](https://www.hulu.com/), header SVG |
| Spotify | `spotify.svg` | [Spotify Design Guidelines](https://developer.spotify.com/documentation/design), `2024-spotify-full-logo.zip` → `Full_Logo_Black_RGB.svg` |
| Peacock | `peacock.png` | [Peacock](https://www.peacocktv.com/), `/dam/growth/assets/Logos/peacock-logo-color.png` |
| Crunchyroll | `crunchyroll.jpg` | [Crunchyroll's publisher listing](https://apps.apple.com/us/app/crunchyroll/id329913454), 512px artwork from Apple's public catalog for `com.crunchyroll.iphone`, published by Crunchyroll, LLC |
| ESPN | `espn.png` | [ESPN](https://www.espn.com/), `espn_red.png` served by ESPN's image CDN |
| Tubi | `tubi.png` | [Tubi Corporate](https://corporate.tubitv.com/), `/wp-content/uploads/2024/02/logo-footer.png` |
| HBO Max | `hbomax.svg` | [HBO Max brand guidelines](https://brand.hbomax.com/logos), `HBO_Max_Vert_W_RGB.svg`, the official pure-white stacked wordmark |
| Paramount+ | `paramount.jpg` | [Publisher listing](https://apps.apple.com/us/app/paramount/id530168168), CBS Mobile, 512px app artwork from Apple’s public catalog |
| Apple TV | `appletv.jpg` | [Publisher listing](https://apps.apple.com/us/app/apple-tv/id1174078549), Apple Inc., 512px app artwork from Apple’s public catalog |
| Pluto TV | `pluto.jpg` | [Publisher listing](https://apps.apple.com/us/app/pluto-tv-watch-free-movies-tv/id751712884), Pluto, Inc., 512px app artwork from Apple’s public catalog |
| YouTube TV | `youtubetv.jpg` | [Publisher listing](https://apps.apple.com/us/app/youtube-tv/id1193350206), Google LLC, 512px app artwork from Apple’s public catalog |
| Fubo | `fubo.jpg` | [Publisher listing](https://apps.apple.com/us/app/fubo-watch-live-tv-sports/id905401434), fuboTV Inc., 512px app artwork from Apple’s public catalog |
| DIRECTV | `directv.jpg` | [Publisher listing](https://apps.apple.com/us/app/directv-tv-movie-streaming/id1136238277), DIRECTV, 512px app artwork from Apple’s public catalog |
| ViX | `vix.jpg` | [Publisher listing](https://apps.apple.com/us/app/vix-tv-sports-and-news/id1531467766), Univision Communications Inc., 512px app artwork from Apple’s public catalog |
| discovery+ | `discovery.jpg` | [Publisher listing](https://apps.apple.com/us/app/discovery-stream-tv-shows/id1498327873), Discovery Communications, 512px app artwork from Apple’s public catalog |
| STARZ | `starz.jpg` | [Publisher listing](https://apps.apple.com/us/app/starz/id550221096), Starz Entertainment, 512px app artwork from Apple’s public catalog |
| AMC+ | `amc.jpg` | [Publisher listing](https://apps.apple.com/us/app/amc-tv-shows-movies/id1578728899), Digital Store LLC, 512px app artwork from Apple’s public catalog |
| PBS | `pbs.jpg` | [Publisher listing](https://apps.apple.com/us/app/pbs-watch-tv-documentaries/id398349296), Public Broadcasting Service, 512px app artwork from Apple’s public catalog |
| Sling TV | `sling.png` | [Sling TV newsroom](https://www.sling.com/sling-newsroom/media/356653/sling-logo-artcard-1x1-light-transparent-rgb), `SLING_LOGO_ARTCARD_1x1_Light_Transparent_RGB`, the official cyan wordmark with transparency |
| The Roku Channel | `roku.png` | [Roku publisher listing](https://play.google.com/store/apps/details?id=com.roku.web.trc), Roku, Inc. & its affiliates, 512px app artwork |
| Samsung TV Plus | `tvplus.svg` | [Samsung TV Plus](https://www.samsungtvplus.com/), `/img/logo.svg` header logo |

Raster images and the supplied Spotify SVG retain their downloaded bytes.
Trailing whitespace was removed from the Samsung TV Plus SVG.
The Plex and Hulu SVGs were extracted from their headers with SVG namespace and
`viewBox` spelling restored; Plex's inherited foreground color is set to white.
YouTube's SVG literal was decoded from its brand site's public component bundle.
Logo geometry is preserved. SVGs were checked for scripts and external references.

On 2026-10-19, the HBO Max and Sling square app images were replaced with the
official transparent wordmarks above. Their downloaded bytes remain unchanged.
HBO Max sits on a dark tile with clear space. Sling's transparent artcard fills
the landscape tile through CSS cropping of its empty margins. The service lookup
also recognizes the S89C titles **Spotify - Music and Podcasts** and
**Tubi - Free Movies ＆ TV**, including Tubi's ASCII ampersand variant. These
aliases select artwork while discovery continues to supply launch IDs.

The launcher bundles each image; the workbench serves the same files from loopback.
Both keep the supplied aspect ratio. The transparent Disney+ wordmark replaced
the earlier JPEG card on 2026-10-21 to remove its rectangular background from
Home Shelf. Its downloaded bytes remain unchanged. ESPN supplies complete card
artwork. Local Cinema is a fictional preview entry
and keeps its text treatment. The input glyphs are original project art.


## Service selection

The catalog contains 25 U.S. video streaming services and retains Spotify as an
extra music option. Selection combines the leading services covered by
[Nielsen’s Gauge](https://www.nielsen.com/data-center/the-gauge/) with live TV,
sports and specialist services. It is a curated catalog; the order carries no
measured ranking. Production names and artwork filenames live in
[`streaming-artwork.js`](../streaming-artwork.js); simulated app IDs live in
[`preview/streaming-apps.js`](../../preview/streaming-apps.js).

Extra services appear in the concept’s simulated Add apps list. The current
Home shortcuts remain the default. Adding a shortcut in the workbench simulates
an app already installed on a TV. Actual installation uses
[Samsung’s Apps store](https://www.samsung.com/us/support/answer/ANS10005205/).
The TV’s store determines availability for its model, region and account.
`DemoStream.*` IDs identify preview fixtures. Real device discovery supplies
installed IDs before a service can be launched.
