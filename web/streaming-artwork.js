/* Local artwork matched to installed app names; never supplies launch IDs. */
(function (root) {
  'use strict';
  var apps = [
    { name: 'YouTube', logo: 'youtube.svg' },
    { name: 'Netflix', logo: 'netflix.png' },
    { name: 'Prime Video', logo: 'prime.png' },
    { name: 'Disney+', logo: 'disney.png' },
    { name: 'Hulu', logo: 'hulu.svg' },
    { name: 'HBO Max', aliases: ['Max'], logo: 'hbomax.svg', color: '#11141b' },
    { name: 'Paramount+', logo: 'paramount.jpg', color: '#0065ff', icon: true },
    { name: 'Peacock', aliases: ['Peacock TV'], logo: 'peacock.png' },
    { name: 'Apple TV', aliases: ['Apple TV+'], logo: 'appletv.jpg', color: '#313131', icon: true },
    { name: 'Tubi', aliases: ['Tubi - Free Movies ＆ TV', 'Tubi - Free Movies & TV'], logo: 'tubi.png' },
    { name: 'The Roku Channel', aliases: ['Roku Channel'], logo: 'roku.png', color: '#fefefe', icon: true },
    { name: 'Pluto TV', logo: 'pluto.jpg', color: '#fef200', icon: true },
    { name: 'Samsung TV Plus', logo: 'tvplus.svg', color: '#111113' },
    { name: 'Plex', logo: 'plex.svg' },
    { name: 'YouTube TV', logo: 'youtubetv.jpg', color: '#ffffff', icon: true },
    { name: 'Sling TV', logo: 'sling.png', color: '#111113' },
    { name: 'Fubo', aliases: ['fuboTV'], logo: 'fubo.jpg', color: '#ff0600', icon: true },
    { name: 'DIRECTV', aliases: ['DIRECTV STREAM'], logo: 'directv.jpg', color: '#000443', icon: true },
    { name: 'ViX', logo: 'vix.jpg', color: '#ff5683', icon: true },
    { name: 'ESPN', logo: 'espn.png' },
    { name: 'Crunchyroll', logo: 'crunchyroll.jpg' },
    { name: 'discovery+', logo: 'discovery.jpg', color: '#161e45', icon: true },
    { name: 'STARZ', logo: 'starz.jpg', color: '#3c8387', icon: true },
    { name: 'AMC+', logo: 'amc.jpg', color: '#0c1524', icon: true },
    { name: 'PBS', aliases: ['PBS Video'], logo: 'pbs.jpg', color: '#2031b3', icon: true },
    { name: 'Spotify', aliases: ['Spotify - Music and Podcasts'], logo: 'spotify.svg' }
  ];
  if (typeof module !== 'undefined') module.exports = apps;
  else root.HubStreamingArtwork = apps;
}(typeof window !== 'undefined' ? window : globalThis));
