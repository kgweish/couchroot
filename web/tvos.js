/* S89C design shared with the workbench. App IDs always come from discovery. */
(function () {
  'use strict';
  if (document.body.getAttribute('data-design') !== 'tvos') return;
  document.addEventListener('DOMContentLoaded', function () {
    document.body.classList.add('design-tvos');
    var main = document.querySelector('main'), clock = document.getElementById('home-clock');
    var title = document.createElement('h1'); title.id = 'design-title';
    var date = document.createElement('time'); date.id = 'design-date';
    main.insertBefore(title, clock); main.insertBefore(date, clock);
    var greetingTimer, landscapeTimer, landscapeDeadline;
    function updateGreeting() {
      clearTimeout(greetingTimer);
      if (document.hidden) return;
      var now = new Date(), hour = now.getHours();
      title.textContent = hour >= 5 && hour < 12 ? 'Good morning' : hour >= 12 && hour < 17 ? 'Good afternoon' : 'Good evening';
      date.textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
      date.dateTime = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2) + '-' + ('0' + now.getDate()).slice(-2);
      greetingTimer = setTimeout(updateGreeting, 60000 - Date.now() % 60000);
    }
    updateGreeting();
    var landscapes = [
      { image: 'photo-1476041178066-aa562074def7', credit: 'Blanca Lake · Yoshi Takekawa / Unsplash' },
      { image: 'photo-1762212702272-ff305c168c80', credit: 'Alpine landscape · Diggity Dog / Unsplash' },
      { image: 'photo-1777479641988-ef604050084d', credit: 'Mountain lake · Sergi Kabrera / Unsplash' }
    ];
    var ambient = document.querySelector('.ambient'), frames = [], active = -1, next = 0, loading = false;
    var credit = document.createElement('p'); credit.id = 'design-photo-credit'; main.appendChild(credit);
    for (var frame = 0; frame < 2; frame++) {
      var image = document.createElement('img'); image.className = 'design-landscape'; image.alt = '';
      image.referrerPolicy = 'no-referrer'; ambient.appendChild(image); frames.push(image);
    }
    function scheduleLandscape() {
      if (!document.hidden) landscapeTimer = setTimeout(loadLandscape, 60000);
    }
    function loadLandscape() {
      clearTimeout(landscapeTimer);
      if (document.hidden || loading) return;
      loading = true;
      var photo = landscapes[next], incoming = active === 0 ? 1 : 0;
      next = (next + 1) % landscapes.length;
      frames[incoming].onload = function () {
        clearTimeout(landscapeDeadline); loading = false;
        if (!document.hidden) {
          if (active >= 0) frames[active].classList.remove('is-active');
          frames[incoming].classList.add('is-active'); active = incoming;
          credit.textContent = photo.credit;
        }
        scheduleLandscape();
      };
      frames[incoming].onerror = function () { clearTimeout(landscapeDeadline); loading = false; scheduleLandscape(); };
      landscapeDeadline = setTimeout(function () {
        frames[incoming].onload = frames[incoming].onerror = null;
        frames[incoming].removeAttribute('src'); loading = false; scheduleLandscape();
      }, 15000);
      frames[incoming].src = 'https://images.unsplash.com/' + photo.image + '?auto=format&fit=crop&w=1920&q=80';
    }
    loadLandscape();
    document.addEventListener('visibilitychange', function () {
      clearTimeout(landscapeTimer); updateGreeting();
      if (!document.hidden) loadLandscape();
    });
    var grid = document.getElementById('favorites');
    function addLogo(tile, name, row) {
      if (tile.querySelector('.design-brand-logo, .design-row-logo')) return;
      var service = HubStreamingArtwork.filter(function (app) {
        return app.name === name || (app.aliases || []).indexOf(name) >= 0;
      })[0];
      var file = service ? service.logo : name === 'Spotify' ? 'spotify.svg' : '';
      if (!file) return;
      var image = document.createElement('img'); image.className = row ? 'design-row-logo' : 'design-brand-logo'; image.alt = '';
      if (!row && service) {
        if (service.icon) image.classList.add('design-square-art');
      }
      image.onload = function () {
        if (!row && service && service.color) tile.style.background = service.color;
        tile.classList.add('design-has-logo');
      };
      image.onerror = function () { image.remove(); };
      image.src = 'logos/' + file;
      if (row) tile.insertBefore(image, tile.querySelector('.row-name')); else tile.appendChild(image);
    }
    function decorate() {
      document.body.classList.toggle('design-moving', grid.classList.contains('reordering'));
      Array.prototype.forEach.call(grid.children, function (tile) {
        if (tile.querySelector('.design-caption')) return;
        var label = document.createElement('span'); label.className = 'design-caption';
        label.textContent = tile.getAttribute('aria-label').replace(/^(Open|Move) /, '');
        label.setAttribute('aria-hidden', 'true'); tile.appendChild(label);
        addLogo(tile, label.textContent, false);
        if (/^(Live TV|HDMI [0-9]+)( · via Home)?$/.test(label.textContent)) {
          tile.classList.add('design-input');
          var live = label.textContent.indexOf('Live TV') === 0;
          tile.classList.toggle('design-live', live);
          var icon = '<svg class="design-source-icon" viewBox="0 0 80 64" aria-hidden="true"><rect x="7" y="6" width="66" height="43" rx="5"/><path d="M28 58h24M40 49v9"/>' +
            (live ? '<path class="design-play" d="m34 17 17 10-17 10z"/>' : '<path d="M25 20h30l-4 15H29zM33 24v7m7-7v7m7-7v7"/>') + '</svg>';
          tile.insertAdjacentHTML('afterbegin', icon);
        }
      });
      window.dispatchEvent(new Event('resize'));
    }
    decorate(); new MutationObserver(decorate).observe(grid, { childList: true, attributes: true, attributeFilter: ['class'] });
    var list = document.getElementById('editor-list'), art = document.getElementById('preview-art');
    new MutationObserver(function () {
      Array.prototype.forEach.call(list.querySelectorAll('.app-row'), function (row) {
        addLogo(row, row.querySelector('.row-name').textContent, true);
      });
    }).observe(list, { childList: true });
    new MutationObserver(function () {
      if (art.firstElementChild) addLogo(art.firstElementChild, document.getElementById('preview-name').textContent, false);
    }).observe(art, { childList: true });
  });
}());
