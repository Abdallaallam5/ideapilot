/* Video guide: chapter buttons seek the video, and the current chapter is highlighted while it plays. */
(function () {
  'use strict';
  var video = document.getElementById('guideVideo');
  if (!video) return;
  var buttons = Array.prototype.slice.call(document.querySelectorAll('[data-chapter-time]'));
  var times = buttons.map(function (b) { return Number(b.getAttribute('data-chapter-time')); });

  function highlight() {
    var t = video.currentTime;
    var current = 0;
    for (var i = 0; i < times.length; i++) if (t >= times[i]) current = i;
    buttons.forEach(function (b, i) {
      b.classList.toggle('is-active', i === current);
      if (i === current) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
  }

  buttons.forEach(function (b, i) {
    b.addEventListener('click', function () {
      video.currentTime = times[i];
      var p = video.play();
      if (p && p.catch) p.catch(function () {});
      highlight();
      if (window.innerWidth < 992) video.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });
  video.addEventListener('timeupdate', highlight);
  highlight();
})();
