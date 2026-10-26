/* S89C design shared with the workbench. App IDs always come from discovery. */
(function () {
  'use strict';
  if (document.body.getAttribute('data-design') !== 'tvos') return;
  document.addEventListener('DOMContentLoaded', function () {
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
      { image: 'photo-1777479641988-ef604050084d', credit: 'Mountain lake · Sergi Kabrera / Unsplash' },
      { image: 'photo-1775755288625-c5fae11142f1', credit: 'Rocky coast · Kellen Riggin / Unsplash' },
      { image: 'photo-1466547409737-7314062bcb5a', credit: 'Forest waterfall · Gabe Hobbs / Unsplash' },
      { image: 'photo-1765498069015-aaf7e6bc1759', credit: 'White Sands · Royce Fonseca / Unsplash' },
      { image: 'photo-1545994111-2c7705641ae3', credit: 'Pine forest · Handy Wicaksono / Unsplash' },
      { image: 'photo-1445217143695-467124038776', credit: 'Diablo Lake · Sergei A / Unsplash' },
      { image: 'photo-1686854010079-455de3e8db41', credit: 'Pyramid Lake · Dennis_TM / Unsplash' },
      { image: 'photo-1748499429963-85c58cb2b95e', credit: 'Snowdonia · fabian jones / Unsplash' },
      { image: 'photo-1781211901640-eebb5676995a', credit: 'Lake Minnewanka · Rafael Peier / Unsplash' },
      { image: 'photo-1779111717252-0d8f0b7fd6e2', credit: 'Lake Geneva · Mikheil Kuzmidi / Unsplash' },
      { image: 'photo-1750155680590-328cdc01709e', credit: 'Swiss Alps · Pascal Debrunner / Unsplash' },
      { image: 'photo-1680761060530-87f01f1f1803', credit: 'California dunes · Zetong Li / Unsplash' },
      { image: 'photo-1544900961-5d1924f3b3aa', credit: 'Thar Desert · Sharad Bhat / Unsplash' }
    ];
    var ambient = document.querySelector('.ambient'), frames = [], active = -1, next = 0, loading = false;
    var landscapeRemaining = 60000, landscapeDue = 0;
    var credit = document.createElement('p'); credit.id = 'design-photo-credit'; main.appendChild(credit);
    for (var frame = 0; frame < 2; frame++) {
      var image = document.createElement('img'); image.className = 'design-landscape'; image.alt = '';
      image.referrerPolicy = 'no-referrer'; ambient.appendChild(image); frames.push(image);
    }
    function scheduleLandscape() {
      clearTimeout(landscapeTimer);
      if (!document.hidden && !document.body.classList.contains('photos-off')) {
        landscapeDue = Date.now() + landscapeRemaining;
        landscapeTimer = setTimeout(loadLandscape, landscapeRemaining);
      }
    }
    function loadLandscape() {
      clearTimeout(landscapeTimer); landscapeDue = 0;
      if (document.hidden || loading || document.body.classList.contains('photos-off')) return;
      loading = true; landscapeRemaining = 60000;
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
    document.addEventListener('hub-photos-change', function () {
      clearTimeout(landscapeTimer); clearTimeout(landscapeDeadline); loading = false;
      frames.forEach(function (image) {
        image.onload = image.onerror = null; image.removeAttribute('src'); image.classList.remove('is-active');
      });
      active = -1; credit.textContent = '';
      loadLandscape();
    });
    document.addEventListener('visibilitychange', function () {
      clearTimeout(landscapeTimer); clearTimeout(heroTimer); updateGreeting();
      if (document.hidden && landscapeDue) {
        landscapeRemaining = Math.max(0, landscapeDue - Date.now()); landscapeDue = 0;
      }
      if (!document.hidden) {
        if (active >= 0) scheduleLandscape(); else loadLandscape();
        updateHero();
      }
    });
    var grid = document.getElementById('favorites');
    var hero = document.getElementById('cinema-hero'), heroLogo = document.getElementById('cinema-logo');
    var heroName = document.getElementById('cinema-name'), heroPrompt = document.getElementById('cinema-prompt');
    var heroTimer, heroId = '', heroLayout = '';
    function serviceFor(name) {
      return HubStreamingArtwork.filter(function (app) { return app.name === name || (app.aliases || []).indexOf(name) >= 0; })[0];
    }
    function updateHero() {
      clearTimeout(heroTimer);
      var shelf = document.body.classList.contains('design-shelf');
      var layout = shelf ? 'shelf' : document.body.classList.contains('design-cinema') ? 'cinema' : '';
      if (shelf || heroLayout === 'shelf') {
        var selected = grid.classList.contains('reordering') ? -1 : Array.prototype.indexOf.call(grid.children, document.activeElement);
        Array.prototype.forEach.call(grid.children, function (tile, index) {
          tile.classList.toggle('shelf-after-focus', shelf && selected >= 0 &&
            index > selected && Math.floor(index / 10) === Math.floor(selected / 10));
        });
      }
      if (heroLayout !== layout) { heroId = ''; heroLogo.onload = heroLogo.onerror = null; heroLayout = layout; }
      hero.hidden = !layout || grid.classList.contains('reordering');
      var tile = document.activeElement;
      if (hero.hidden || document.hidden || document.body.classList.contains('cinema-library-open')) return;
      if (!grid.contains(tile)) {
        tile = grid.firstElementChild;
        if (!tile) {
          heroId = ''; heroLogo.onload = heroLogo.onerror = null; heroLogo.removeAttribute('src'); heroLogo.hidden = true;
          hero.classList.remove('cinema-card-logo'); heroName.hidden = false; heroName.textContent = shelf ? 'Your shelf' : 'Your cinema'; heroPrompt.textContent = shelf ? 'Add apps to your shelf' : 'Add favorites or browse all apps'; return;
        }
        if (heroId) return;
      }
      // Local artwork changes after focus settles; arrows never request another landscape.
      heroTimer = setTimeout(function () {
        var name = tile.getAttribute('aria-label').replace(/^Open /, ''), service = serviceFor(name);
        heroName.textContent = name;
        heroPrompt.textContent = tile.classList.contains('unavailable') ? 'Unavailable · Edit apps to remove' : tile.classList.contains('design-input') ? 'Press OK to select through Samsung Home' : 'Press OK to open ' + name;
        hero.style.setProperty('--cinema-accent', getComputedStyle(tile).getPropertyValue('--accent'));
        if (shelf) { heroId = tile.dataset.id; heroLogo.onload = heroLogo.onerror = null; heroLogo.hidden = true; heroName.hidden = false; return; }
        if (heroId === tile.dataset.id) return;
        heroId = tile.dataset.id; heroLogo.hidden = true; heroName.hidden = false;
        hero.classList.toggle('cinema-card-logo', !!(service && (service.icon || /\.jpg$/.test(service.logo))));
        heroLogo.onload = function () { heroLogo.hidden = false; heroName.hidden = !hero.classList.contains('cinema-card-logo'); };
        heroLogo.onerror = function () { heroLogo.hidden = true; heroName.hidden = false; };
        if (service) heroLogo.src = 'logos/' + service.logo;
        else heroLogo.removeAttribute('src');
      }, window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160);
    }
    document.addEventListener('focusin', updateHero);
    document.addEventListener('hub-layout-change', function () { decorate(); updateHero(); });
    function addLogo(tile, name, row) {
      if (!document.body.classList.contains('design-tvos')) return;
      if (tile.querySelector('.design-brand-logo, .design-row-logo')) return;
      var service = serviceFor(name);
      var file = service ? service.logo : '';
      if (!file) return;
      var image = document.createElement('img'); image.className = row ? 'design-row-logo' : 'design-brand-logo'; image.alt = '';
      if (!row && service) {
        if (service.icon) image.classList.add('design-square-art');
        if (service.logo === 'hbomax.svg') tile.classList.add('brand-hbomax');
      }
      image.onload = function () {
        if (!row && service && service.color) tile.style.background = service.color;
        tile.classList.add('design-has-logo');
      };
      image.onerror = function () { image.remove(); };
      image.src = 'logos/' + file;
      if (row) tile.insertBefore(image, tile.querySelector('.row-name')); else tile.appendChild(image);
      if (document.body.classList.contains('design-shelf') && tile.parentElement === grid) {
        var badge = image.cloneNode(false); badge.className = 'shelf-brand-badge';
        badge.onerror = function () { badge.remove(); }; tile.appendChild(badge);
      }
    }
    function decorate() {
      var gallery = document.body.classList.contains('design-tvos');
      document.body.classList.toggle('design-moving', gallery && grid.classList.contains('reordering'));
      if (!gallery) return;
      var addedCaption = false;
      Array.prototype.forEach.call(grid.children, function (tile) {
        if (tile.querySelector('.design-caption')) return;
        var label = document.createElement('span'); label.className = 'design-caption';
        label.textContent = tile.getAttribute('aria-label').replace(/^(Open|Move) /, '');
        label.setAttribute('aria-hidden', 'true'); tile.appendChild(label); addedCaption = true;
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
      if (addedCaption) window.dispatchEvent(new Event('resize'));
      updateHero();
    }
    decorate(); updateHero(); new MutationObserver(decorate).observe(grid, { childList: true, attributes: true, attributeFilter: ['class'] });
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
