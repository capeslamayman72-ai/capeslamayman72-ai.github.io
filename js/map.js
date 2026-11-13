/* ============================================================
   الخرائط — مكتبة Leaflet بخرائط شكلها زي جوجل ماب
   ------------------------------------------------------------
   «خريطة»: شوارع وأسماء واضحة (CARTO Voyager).
   «قمر صناعي»: صور حقيقية من فوق (Esri) وفوقها أسماء الشوارع.
   نفس الواجهة القديمة (MiniMap) عشان كل الشاشات تفضل شغالة زي ما هي:
   setMarkers / setCircles / setLines / setCenter / setZoom / fit / destroy.
   ============================================================ */
(function (global) {
  'use strict';

  var CAIRO = { lat: 30.0876, lng: 31.3260 };   /* نقطة بداية للعرض بس */

  function layers() {
    var L = global.L;
    var streets = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd', maxZoom: 20, attribution: '© OpenStreetMap © CARTO'
    });
    var sat = L.layerGroup([
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19, attribution: '© Esri'
      }),
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd', maxZoom: 20
      })
    ]);
    return { streets: streets, satellite: sat };
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function MiniMap(container, opts) {
    opts = opts || {};
    this.el = typeof container === 'string' ? document.getElementById(container) : container;
    this.markers = []; this.circles = []; this.lines = [];
    this.onClick = opts.onClick || null;
    var c = opts.center || CAIRO;
    this.center = c; this.zoom = opts.zoom || 12;

    if (!global.L) {
      this.map = null;
      this.el.innerHTML = '<div class="lf-off">تعذّر تحميل الخريطة — اتأكد من النت</div>';
      return;
    }
    var self = this, L = global.L;
    this.el.classList.add('lf-map');
    this.map = L.map(this.el, { zoomControl: false, attributionControl: true, tap: true })
      .setView([c.lat, c.lng], this.zoom);
    this.map.attributionControl.setPrefix(false);
    L.control.zoom({ position: 'topleft', zoomInTitle: 'تكبير', zoomOutTitle: 'تصغير' }).addTo(this.map);

    this.base = layers();
    this.base[opts.style === 'satellite' ? 'satellite' : 'streets'].addTo(this.map);
    L.control.layers({ '🗺 خريطة': this.base.streets, '🛰 قمر صناعي': this.base.satellite }, null,
                     { position: 'topright', collapsed: false }).addTo(this.map);

    /* زرار «عرض الكل» */
    var Fit = L.Control.extend({
      options: { position: 'topleft' },
      onAdd: function () {
        var b = L.DomUtil.create('a', 'lf-fit');
        b.href = '#'; b.title = 'عرض الكل'; b.innerHTML = '⤢';
        L.DomEvent.on(b, 'click', function (e) { L.DomEvent.stop(e); self.fit(); });
        var wrap = L.DomUtil.create('div', 'leaflet-bar');
        wrap.appendChild(b);
        return wrap;
      }
    });
    new Fit().addTo(this.map);

    this.group = L.layerGroup().addTo(this.map);
    this.map.on('click', function (e) { if (self.onClick) self.onClick({ lat: e.latlng.lat, lng: e.latlng.lng }); });
    this.map.on('moveend zoomend', function () {
      var ce = self.map.getCenter();
      self.center = { lat: ce.lat, lng: ce.lng }; self.zoom = self.map.getZoom();
    });

    /* النوافذ بتتفتح بعد ما الخريطة تتعمل — لازم تعرف مقاسها الحقيقي */
    if (global.ResizeObserver) {
      this._ro = new ResizeObserver(function () { if (self.map) self.map.invalidateSize(); });
      this._ro.observe(this.el);
    }
    setTimeout(function () { if (self.map) self.map.invalidateSize(); }, 80);
  }

  MiniMap.prototype.setCenter = function (lat, lng, zoom) {
    this.center = { lat: lat, lng: lng };
    if (zoom) this.zoom = zoom;
    if (this.map) this.map.setView([lat, lng], zoom || this.map.getZoom());
  };

  MiniMap.prototype.setZoom = function (z) { if (this.map) this.map.setZoom(z); };

  MiniMap.prototype.setStyle = function (key) {
    if (!this.map || !this.base[key]) return;
    var self = this;
    Object.keys(this.base).forEach(function (k) { self.map.removeLayer(self.base[k]); });
    this.base[key].addTo(this.map);
  };

  /* النقاط: [{lat,lng,color,label,title,kind,pulse,onClick,draggable,onDrag}] */
  MiniMap.prototype.setMarkers = function (arr) { this.markers = arr || []; this.render(); };
  MiniMap.prototype.setCircles = function (arr) { this.circles = arr || []; this.render(); };
  MiniMap.prototype.setLines = function (arr) { this.lines = arr || []; this.render(); };

  MiniMap.prototype.render = function () {
    if (!this.map) return;
    var L = global.L, g = this.group;
    g.clearLayers();

    this.circles.forEach(function (c) {
      if (c.lat == null) return;
      L.circle([c.lat, c.lng], {
        radius: c.radius || 200, color: c.color || '#1d75d8', weight: 1.5,
        fillOpacity: c.fillOpacity == null ? 0.12 : c.fillOpacity, dashArray: c.dash || '5 4', interactive: false
      }).addTo(g);
    });

    this.lines.forEach(function (l) {
      var pts = (l.points || []).map(function (p) { return [p.lat, p.lng]; });
      if (pts.length < 2) return;
      L.polyline(pts, {
        color: l.color || '#e63946', weight: l.width || 4, opacity: l.opacity == null ? 0.85 : l.opacity,
        dashArray: l.dash || null, lineJoin: 'round', interactive: false
      }).addTo(g);
    });

    this.markers.forEach(function (m) {
      if (m.lat == null) return;
      var cls = 'lf-mk' + (m.kind ? ' k-' + m.kind : '') + (m.pulse ? ' pulse' : '');
      var icon = L.divIcon({
        className: cls,
        html: '<span class="lf-pin" style="--c:' + esc(m.color || '#e63946') + '"></span>' +
              (m.label ? '<span class="lf-label">' + esc(m.label) + '</span>' : ''),
        iconSize: [28, 28], iconAnchor: [14, 30]
      });
      var mk = L.marker([m.lat, m.lng], { icon: icon, title: m.title || m.label || '', draggable: !!m.draggable, riseOnHover: true }).addTo(g);
      if (m.onClick) mk.on('click', function () { m.onClick(m); });
      if (m.draggable && m.onDrag) mk.on('dragend', function () { var p = mk.getLatLng(); m.onDrag({ lat: p.lat, lng: p.lng }); });
    });
  };

  /* ضبط العرض ليشمل كل النقاط */
  MiniMap.prototype.fit = function (pad) {
    if (!this.map) return;
    var pts = [];
    this.markers.forEach(function (m) { if (m.lat != null) pts.push([m.lat, m.lng]); });
    this.circles.forEach(function (c) { if (c.lat != null) pts.push([c.lat, c.lng]); });
    this.lines.forEach(function (l) { (l.points || []).forEach(function (p) { pts.push([p.lat, p.lng]); }); });
    if (!pts.length) return;
    if (pts.length === 1) { this.map.setView(pts[0], 16); return; }
    var p = pad === undefined ? 40 : pad;
    this.map.fitBounds(global.L.latLngBounds(pts), { padding: [p, p], maxZoom: 17 });
  };

  MiniMap.prototype.destroy = function () {
    if (this._ro) this._ro.disconnect();
    if (this.map) { this.map.remove(); this.map = null; }
    this.el.innerHTML = '';
  };

  /* بحث عن مكان بالاسم (أندية، شوارع، مناطق) — جوه مصر الأول */
  MiniMap.search = function (q) {
    var url = 'https://nominatim.openstreetmap.org/search?format=json&limit=6&accept-language=ar&countrycodes=eg&q=' +
              encodeURIComponent(q);
    return fetch(url, { headers: { 'Accept': 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('البحث مش متاح دلوقتي'); return r.json(); })
      .then(function (list) {
        return (list || []).map(function (x) {
          return { lat: +x.lat, lng: +x.lon, name: x.display_name };
        });
      });
  };

  global.MiniMap = MiniMap;

})(window);
