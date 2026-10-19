/* Review-only styling and navigation over the shipped Home and sample catalog. */
(function () {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    document.body.classList.add('design-tvos');
    var title = document.createElement('h1'); title.id = 'design-title'; title.textContent = 'Home';
    document.querySelector('main').insertBefore(title, document.getElementById('home-clock'));
    document.getElementById('preview').textContent = 'DESIGN MOCKUP · SAMPLE APPS & INPUTS';
    var grid = document.getElementById('favorites');
    function decorate() {
      document.body.classList.toggle('design-moving', grid.classList.contains('reordering'));
      Array.prototype.forEach.call(grid.children, function (tile) {
        if (tile.querySelector('.design-caption')) return;
        var label = document.createElement('span'); label.className = 'design-caption';
        label.textContent = tile.getAttribute('aria-label').replace(/^Open /, '');
        label.setAttribute('aria-hidden', 'true'); tile.appendChild(label);
        if (tile.dataset.id.indexOf('DemoInput1.') === 0) {
          tile.classList.add('design-input');
          var live = tile.dataset.id === 'DemoInput1.tv';
          tile.classList.toggle('design-live', live);
          var icon = '<svg class="design-source-icon" viewBox="0 0 80 64" aria-hidden="true"><rect x="7" y="6" width="66" height="43" rx="5"/><path d="M28 58h24M40 49v9"/>' +
            (live ? '<path class="design-play" d="m34 17 17 10-17 10z"/>' : '<path d="M25 20h30l-4 15H29zM33 24v7m7-7v7m7-7v7"/>') + '</svg>';
          tile.insertAdjacentHTML('afterbegin', icon);
        }
      });
      window.dispatchEvent(new Event('resize'));
    }
    decorate(); new MutationObserver(decorate).observe(grid, { childList: true, attributes: true, attributeFilter: ['class'] });
    // Match the concept's columns while retaining the existing settings and Move flow.
    document.addEventListener('keydown', function (event) {
      if (!/^Arrow/.test(event.key) || grid.hidden || grid.classList.contains('reordering')) return;
      var tiles = Array.prototype.slice.call(grid.children), rows = [];
      var columns = grid.classList.contains('compact') ? 6 : grid.classList.contains('many') ? 3 : 2;
      for (var i = 0; i < tiles.length; i += columns) rows.push(tiles.slice(i, i + columns));
      rows.push(Array.prototype.slice.call(document.querySelectorAll('.bottom-menu footer > button')).filter(function (button) { return !button.hidden; }));
      var row = -1, column;
      rows.forEach(function (items, index) {
        var position = items.indexOf(document.activeElement);
        if (position >= 0) { row = index; column = position; }
      });
      if (row < 0) return;
      event.preventDefault(); event.stopImmediatePropagation();
      var next = HubModel.navigate(rows.map(function (items) { return items.length; }), row, column, event.key);
      rows[next[0]][next[1]].focus();
    }, true);
  });
}());
