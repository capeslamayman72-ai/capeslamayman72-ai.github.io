/* ============================================================
   محرك خرائط بسيط — بدون مكتبات
   يستخدم بلاطات OpenStreetMap المجانية + إسقاط مركاتور
   ============================================================ */
(function (global) {
  'use strict';

  var TILE = 256;

  function lngToX(lng, z) { return (lng + 180) / 360 * Math.pow(2, z); }
  function latToY(lat, z) {
    var r = lat * Math.PI / 180;
    return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z);
  }
  function xToLng(x, z) { return x / Math.pow(2, z) * 360 - 180; }
  function yToLat(y, z) {
    var n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
    return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  }

  var STYLES = {
    streets: {
      name: 'شوارع',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attr: '© OpenStreetMap', max: 19, dark: false
    },
    humanitarian: {
      name: 'واضح',
      url: 'https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
      attr: '© OpenStreetMap / HOT', max: 19, dark: false
    }
  };

  function MiniMap(container, opts) {
    opts = opts || {};
    this.el = typeof container === 'string' ? document.getElementById(container) : container;
    this.center = opts.center || { lat: 30.0876, lng: 31.3260 }; // القاهرة كنقطة بداية للعرض فقط
    this.zoom = opts.zoom || 12;
    this.styleKey = opts.style || 'streets';
    this.markers = [];
    this.circles = [];
    this.lines = [];
    this.onClick = opts.onClick || null;
    this._build();
    this._bind();
    this.render();
  }

  MiniMap.prototype._build = function () {
    var el = this.el;
    el.classList.add('mm');
    el.innerHTML =
      '<div class="mm-tiles"></div>' +
      '<svg class="mm-svg"></svg>' +
      '<div class="mm-overlay"></div>' +
      '<div class="mm-ctrl">' +
        '<button type="button" class="mm-btn" data-act="in" title="تكبير">+</button>' +
        '<button type="button" class="mm-btn" data-act="out" title="تصغير">−</button>' +
        '<button type="button" class="mm-btn" data-act="fit" title="عرض الكل">⤢</button>' +
      '</div>' +
      '<div class="mm-attr"></div>' +
      '<div class="mm-offline">تعذّر تحميل الخريطة — النقاط معروضة بمواقعها النسبية</div>';
    this.tiles = el.querySelector('.mm-tiles');
    this.svg = el.querySelector('.mm-svg');
    this.overlay = el.querySelector('.mm-overlay');
    this.attrEl = el.querySelector('.mm-attr');
    this.offlineEl = el.querySelector('.mm-offline');
  };

  MiniMap.prototype._bind = function () {
    var self = this, drag = null, moved = false;

    this.el.querySelector('.mm-ctrl').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      e.stopPropagation();
      if (b.dataset.act === 'in') self.setZoom(self.zoom + 1);
      else if (b.dataset.act === 'out') self.setZoom(self.zoom - 1);
      else self.fit();
    });

    function down(x, y) { drag = { x: x, y: y, cx: self.center.lat, cy: self.center.lng }; moved = false; self.el.classList.add('dragging'); }
    function move(x, y) {
      if (!drag) return;
      var dx = x - drag.x, dy = y - drag.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      var scale = Math.pow(2, self.zoom) * TILE;
      var cx = lngToX(drag.cy, self.zoom) * TILE - dx;
      var cy = latToY(drag.cx, self.zoom) * TILE - dy;
      self.center = { lat: yToLat(cy / TILE, self.zoom), lng: xToLng(cx / TILE, self.zoom) };
      self.render();
    }
    function up() { self.el.classList.remove('dragging'); drag = null; }

    this.el.addEventListener('mousedown', function (e) {
      if (e.target.closest('.mm-ctrl') || e.target.closest('.mm-marker')) return;
      e.preventDefault(); down(e.clientX, e.clientY);
    });
    window.addEventListener('mousemove', function (e) { if (drag) move(e.clientX, e.clientY); });
    window.addEventListener('mouseup', up);

    this.el.addEventListener('click', function (e) {
      if (moved || !self.onClick) return;
      if (e.target.closest('.mm-ctrl') || e.target.closest('.mm-marker')) return;
      var r = self.el.getBoundingClientRect();
      self.onClick(self.pointToLatLng(e.clientX - r.left, e.clientY - r.top));
    });

    this.el.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = self.el.getBoundingClientRect();
      var anchor = self.pointToLatLng(e.clientX - r.left, e.clientY - r.top);
      var nz = self.zoom + (e.deltaY < 0 ? 1 : -1);
      self.setZoom(nz, anchor, { x: e.clientX - r.left, y: e.clientY - r.top });
    }, { passive: false });

    // لمس — سحب وتكبير بإصبعين
    var pinch = null;
    this.el.addEventListener('touchstart', function (e) {
      if (e.touches.length === 1) down(e.touches[0].clientX, e.touches[0].clientY);
      else if (e.touches.length === 2) {
        drag = null;
        pinch = { d: dist2(e.touches), z: self.zoom };
      }
    }, { passive: true });

    this.el.addEventListener('touchmove', function (e) {
      if (e.touches.length === 1 && drag) { move(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); }
      else if (e.touches.length === 2 && pinch) {
        var d = dist2(e.touches);
        var nz = pinch.z + Math.log2(d / pinch.d);
        self.setZoom(Math.round(nz));
        e.preventDefault();
      }
    }, { passive: false });

    this.el.addEventListener('touchend', function () { up(); pinch = null; });

    function dist2(t) {
      var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    if (window.ResizeObserver) {
      this._ro = new ResizeObserver(function () { self.render(); });
      this._ro.observe(this.el);
    }
  };

  MiniMap.prototype.size = function () {
    return { w: this.el.clientWidth || 600, h: this.el.clientHeight || 400 };
  };

  MiniMap.prototype.latLngToPoint = function (lat, lng) {
    var s = this.size();
    var z = this.zoom;
    var cx = lngToX(this.center.lng, z) * TILE;
    var cy = latToY(this.center.lat, z) * TILE;
    return {
      x: lngToX(lng, z) * TILE - cx + s.w / 2,
      y: latToY(lat, z) * TILE - cy + s.h / 2
    };
  };

  MiniMap.prototype.pointToLatLng = function (px, py) {
    var s = this.size();
    var z = this.zoom;
    var cx = lngToX(this.center.lng, z) * TILE;
    var cy = latToY(this.center.lat, z) * TILE;
    return {
      lat: yToLat((cy - s.h / 2 + py) / TILE, z),
      lng: xToLng((cx - s.w / 2 + px) / TILE, z)
    };
  };

  MiniMap.prototype.setZoom = function (z, anchorLatLng, anchorPx) {
    var st = STYLES[this.styleKey];
    z = Math.max(3, Math.min(st.max, Math.round(z)));
    if (z === this.zoom) return;
    this.zoom = z;
    if (anchorLatLng && anchorPx) {
      // نحافظ على النقطة تحت المؤشر ثابتة
      var s = this.size();
      var ax = lngToX(anchorLatLng.lng, z) * TILE;
      var ay = latToY(anchorLatLng.lat, z) * TILE;
      var cx = ax - (anchorPx.x - s.w / 2);
      var cy = ay - (anchorPx.y - s.h / 2);
      this.center = { lat: yToLat(cy / TILE, z), lng: xToLng(cx / TILE, z) };
    }
    this.render();
  };

  MiniMap.prototype.setCenter = function (lat, lng, zoom) {
    this.center = { lat: lat, lng: lng };
    if (zoom) this.zoom = zoom;
    this.render();
  };

  MiniMap.prototype.setStyle = function (key) {
    if (!STYLES[key]) return;
    this.styleKey = key;
    this.tiles.innerHTML = '';
    this.render();
  };

  /* النقاط: [{lat,lng,color,label,title,kind,onClick}] */
  MiniMap.prototype.setMarkers = function (arr) { this.markers = arr || []; this.render(); };
  MiniMap.prototype.setCircles = function (arr) { this.circles = arr || []; this.render(); };
  MiniMap.prototype.setLines = function (arr) { this.lines = arr || []; this.render(); };

  /* ضبط العرض ليشمل كل النقاط */
  MiniMap.prototype.fit = function (pad) {
    var pts = [];
    this.markers.forEach(function (m) { if (m.lat != null) pts.push(m); });
    this.circles.forEach(function (c) { if (c.lat != null) pts.push(c); });
    this.lines.forEach(function (l) { (l.points || []).forEach(function (p) { pts.push(p); }); });
    if (!pts.length) return;

    if (pts.length === 1) { this.setCenter(pts[0].lat, pts[0].lng, 16); return; }

    var minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    pts.forEach(function (p) {
      minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
      minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng);
    });
    var s = this.size();
    var padPx = pad === undefined ? 60 : pad;
    var st = STYLES[this.styleKey];
    var z = st.max;
    for (; z > 3; z--) {
      var w = Math.abs(lngToX(maxLng, z) - lngToX(minLng, z)) * TILE;
      var h = Math.abs(latToY(minLat, z) - latToY(maxLat, z)) * TILE;
      if (w <= s.w - padPx * 2 && h <= s.h - padPx * 2) break;
    }
    this.zoom = z;
    this.center = { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
    this.render();
  };

  MiniMap.prototype.render = function () {
    var s = this.size();
    if (!s.w || !s.h) return;
    var z = this.zoom;
    var st = STYLES[this.styleKey];
    this.attrEl.textContent = st.attr;

    /* --- البلاطات --- */
    var cx = lngToX(this.center.lng, z) * TILE;
    var cy = latToY(this.center.lat, z) * TILE;
    var left = cx - s.w / 2, top = cy - s.h / 2;
    var x0 = Math.floor(left / TILE), y0 = Math.floor(top / TILE);
    var x1 = Math.floor((left + s.w) / TILE), y1 = Math.floor((top + s.h) / TILE);
    var n = Math.pow(2, z);
    var wanted = {};
    var frag = document.createDocumentFragment();
    var self = this;

    for (var x = x0; x <= x1; x++) {
      for (var y = y0; y <= y1; y++) {
        if (y < 0 || y >= n) continue;
        var tx = ((x % n) + n) % n;
        var key = z + '/' + tx + '/' + y;
        wanted[key] = true;
        var existing = this.tiles.querySelector('[data-k="' + key + '"]');
        var px = x * TILE - left, py = y * TILE - top;
        if (existing) {
          existing.style.transform = 'translate(' + px + 'px,' + py + 'px)';
        } else {
          var img = document.createElement('img');
          img.className = 'mm-tile';
          img.dataset.k = key;
          img.style.transform = 'translate(' + px + 'px,' + py + 'px)';
          img.alt = '';
          img.loading = 'eager';
          img.referrerPolicy = 'no-referrer-when-downgrade';
          img.src = st.url.replace('{z}', z).replace('{x}', tx).replace('{y}', y);
          img.onerror = function () { this.classList.add('failed'); self._checkOffline(); };
          img.onload = function () { this.classList.add('ok'); self.el.classList.remove('offline'); };
          frag.appendChild(img);
        }
      }
    }
    this.tiles.appendChild(frag);

    // إزالة البلاطات خارج النطاق
    Array.prototype.forEach.call(this.tiles.children, function (img) {
      if (!wanted[img.dataset.k]) img.remove();
    });

    /* --- الدوائر والخطوط (SVG) --- */
    this.svg.setAttribute('viewBox', '0 0 ' + s.w + ' ' + s.h);
    this.svg.setAttribute('width', s.w);
    this.svg.setAttribute('height', s.h);
    var svgParts = '';

    // متر لكل بكسل عند خط العرض الحالي
    var mPerPx = 156543.03392 * Math.cos(this.center.lat * Math.PI / 180) / Math.pow(2, z);

    this.circles.forEach(function (c) {
      if (c.lat == null) return;
      var p = self.latLngToPoint(c.lat, c.lng);
      var r = (c.radius || 200) / mPerPx;
      if (r < 2) r = 2;
      if (p.x < -r - 50 || p.x > s.w + r + 50 || p.y < -r - 50 || p.y > s.h + r + 50) return;
      svgParts += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + r.toFixed(1) +
        '" fill="' + (c.color || '#1d75d8') + '" fill-opacity="' + (c.fillOpacity == null ? 0.12 : c.fillOpacity) +
        '" stroke="' + (c.color || '#1d75d8') + '" stroke-opacity="0.6" stroke-width="1.5" stroke-dasharray="' + (c.dash || '5 4') + '"/>';
    });

    this.lines.forEach(function (l) {
      var pts = (l.points || []).map(function (p) {
        var q = self.latLngToPoint(p.lat, p.lng);
        return q.x.toFixed(1) + ',' + q.y.toFixed(1);
      });
      if (pts.length < 2) return;
      svgParts += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + (l.color || '#e63946') +
        '" stroke-width="' + (l.width || 3) + '" stroke-opacity="' + (l.opacity == null ? 0.85 : l.opacity) +
        '" stroke-linejoin="round" stroke-linecap="round"' +
        (l.dash ? ' stroke-dasharray="' + l.dash + '"' : '') + '/>';
    });

    this.svg.innerHTML = svgParts;

    /* --- العلامات --- */
    var html = '';
    this.markers.forEach(function (m, i) {
      if (m.lat == null) return;
      var p = self.latLngToPoint(m.lat, m.lng);
      if (p.x < -80 || p.x > s.w + 80 || p.y < -80 || p.y > s.h + 80) return;
      var cls = 'mm-marker' + (m.kind ? ' k-' + m.kind : '') + (m.pulse ? ' pulse' : '');
      html += '<div class="' + cls + '" data-i="' + i + '" style="transform:translate(' +
        (p.x).toFixed(1) + 'px,' + (p.y).toFixed(1) + 'px);--c:' + (m.color || '#e63946') + '"' +
        (m.title ? ' title="' + String(m.title).replace(/"/g, '&quot;') + '"' : '') + '>' +
        '<span class="mm-pin"></span>' +
        (m.label ? '<span class="mm-label">' + String(m.label).replace(/</g, '&lt;') + '</span>' : '') +
        '</div>';
    });
    this.overlay.innerHTML = html;

    this.overlay.onclick = function (e) {
      var t = e.target.closest('.mm-marker');
      if (!t) return;
      e.stopPropagation();
      var m = self.markers[+t.dataset.i];
      if (m && m.onClick) m.onClick(m);
    };
  };

  MiniMap.prototype._checkOffline = function () {
    var imgs = this.tiles.querySelectorAll('.mm-tile');
    if (!imgs.length) return;
    var failed = this.tiles.querySelectorAll('.mm-tile.failed').length;
    if (failed >= imgs.length * 0.7) this.el.classList.add('offline');
  };

  MiniMap.prototype.destroy = function () {
    if (this._ro) this._ro.disconnect();
    this.el.innerHTML = '';
  };

  MiniMap.STYLES = STYLES;
  global.MiniMap = MiniMap;

})(window);
