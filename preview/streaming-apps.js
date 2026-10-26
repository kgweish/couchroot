/* U.S. video-service artwork for local review. DemoStream IDs are simulated. */
(function (root) {
  'use strict';
  var apps = [
    { id: '9Ur5IzDKqV.TizenYouTube', name: 'YouTube', logo: 'youtube.svg' },
    { id: 'org.tizen.netflix-app', name: 'Netflix', logo: 'netflix.png' },
    { id: 'org.tizen.primevideo', name: 'Prime Video', logo: 'prime.png' },
    { id: 'MCmYXNxgcu.DisneyPlus', name: 'Disney+', logo: 'disney.png' },
    { id: 'LBUAQX1exg.Hulu', name: 'Hulu', logo: 'hulu.svg' },
    { id: 'DemoStream.hbomax', name: 'HBO Max', aliases: ['Max'], logo: 'hbomax.svg', color: '#11141b' },
    { id: 'DemoStream.paramount', name: 'Paramount+', logo: 'paramount.jpg', color: '#0065ff', icon: true },
    { id: 'gzcc4LRFBF.Peacock', name: 'Peacock', aliases: ['Peacock TV'], logo: 'peacock.png' },
    { id: 'DemoStream.appletv', name: 'Apple TV', aliases: ['Apple TV+'], logo: 'appletv.jpg', color: '#313131', icon: true },
    { id: '3KA0pm7a7V.TubiTV', name: 'Tubi', logo: 'tubi.png' },
    { id: 'DemoStream.roku', name: 'The Roku Channel', aliases: ['Roku Channel'], logo: 'roku.png', color: '#fefefe', icon: true },
    { id: 'DemoStream.pluto', name: 'Pluto TV', logo: 'pluto.jpg', color: '#fef200', icon: true },
    { id: 'com.samsung.tv.tvplus', name: 'Samsung TV Plus', logo: 'tvplus.svg', color: '#111113' },
    { id: 'kIciSQlYEM.plex', name: 'Plex', logo: 'plex.svg' },
    { id: 'PvWgqxV3Xa.YouTubeTV', name: 'YouTube TV', logo: 'youtubetv.jpg', color: '#ffffff', icon: true },
    { id: 'ZmmGjO6VKO.slingtv', name: 'Sling TV', logo: 'sling.png', color: '#111113' },
    { id: 'DemoStream.fubo', name: 'Fubo', aliases: ['fuboTV'], logo: 'fubo.jpg', color: '#ff0600', icon: true },
    { id: 'DemoStream.directv', name: 'DIRECTV', aliases: ['DIRECTV STREAM'], logo: 'directv.jpg', color: '#000443', icon: true },
    { id: 'DemoStream.vix', name: 'ViX', logo: 'vix.jpg', color: '#ff5683', icon: true },
    { id: 'XtU8fQk2gN.ESPN', name: 'ESPN', logo: 'espn.png' },
    { id: 'OGLLvqej7u.CrunchyrollWebApp', name: 'Crunchyroll', logo: 'crunchyroll.jpg' },
    { id: 'DemoStream.discovery', name: 'discovery+', logo: 'discovery.jpg', color: '#161e45', icon: true },
    { id: 'DemoStream.starz', name: 'STARZ', logo: 'starz.jpg', color: '#3c8387', icon: true },
    { id: 'Ob3XhAVMu6.amcplus', name: 'AMC+', logo: 'amc.jpg', color: '#0c1524', icon: true },
    { id: '70fRFUwYlD.OtterGAProd', name: 'PBS', aliases: ['PBS Video'], logo: 'pbs.jpg', color: '#2031b3', icon: true }
  ];
  if (typeof module !== 'undefined') module.exports = apps;
  else root.HubStreamingApps = apps;
}(typeof window !== 'undefined' ? window : globalThis));
