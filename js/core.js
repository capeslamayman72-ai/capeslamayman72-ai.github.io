/* ============================================================
   نظام إدارة سيارات الإسعاف — النواة المشتركة
   بدون أي مكتبات خارجية. يعمل من الملف مباشرة أو من استضافة.
   ============================================================ */
(function (global) {
  'use strict';

  /* ---------------- أدوات عامة ---------------- */

  var AR_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  var AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
                   'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

  function uid(prefix) {
    return (prefix || 'x') + '_' + Date.now().toString(36) + '_' +
           Math.random().toString(36).slice(2, 8);
  }

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // "2026-08-21" -> كائن تاريخ محلي (تفادي انزياح المنطقة الزمنية)
  function parseDay(iso) {
    if (!iso) return null;
    var p = String(iso).split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }

  function toISODay(d) {
    if (!d) return '';
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function today() { return toISODay(new Date()); }

  function fmtDay(iso) {
    var d = parseDay(iso);
    if (!d) return '—';
    return AR_DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + AR_MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }

  function fmtDayShort(iso) {
    var d = parseDay(iso);
    if (!d) return '—';
    return AR_DAYS[d.getDay()] + ' ' + d.getDate() + '/' + (d.getMonth() + 1);
  }

  // "16:30" -> "٤:٣٠ م" بصيغة عربية مقروءة
  function fmtTime(hhmm) {
    if (!hhmm) return '—';
    var p = String(hhmm).split(':');
    var h = +p[0], m = p[1] || '00';
    var suffix = h < 12 ? 'ص' : 'م';
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    return h12 + ':' + m + ' ' + suffix;
  }

  function fmtStamp(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    return fmtDayShort(toISODay(d)) + ' — ' +
           fmtTime(String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'));
  }

  function fmtClock(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    return fmtTime(String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'));
  }

  // "منذ كام" بالعربي
  function ago(ts) {
    if (!ts) return 'لا يوجد';
    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 0) s = 0;
    if (s < 45) return 'الآن';
    if (s < 90) return 'منذ دقيقة';
    var m = Math.round(s / 60);
    if (m < 60) return 'منذ ' + m + ' دقيقة';
    var h = Math.round(m / 60);
    if (h < 24) return 'منذ ' + h + ' ساعة';
    var d = Math.round(h / 24);
    return 'منذ ' + d + ' يوم';
  }

  /* مدة بالدقايق -> نص عربي مقروء ("٣ ساعات و١٥ دقيقة") */
  function fmtMins(m) {
    m = Math.round(Math.abs(Number(m) || 0));
    if (m < 60) return m + ' دقيقة';
    var h = Math.floor(m / 60), r = m % 60;
    var hs = h === 1 ? 'ساعة' : h === 2 ? 'ساعتين' : (h <= 10 ? h + ' ساعات' : h + ' ساعة');
    return hs + (r ? ' و' + r + ' دقيقة' : '');
  }

  function money(n) {
    n = Number(n) || 0;
    return n.toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' ج';
  }

  function num(n, digits) {
    n = Number(n) || 0;
    return n.toLocaleString('en-US', { maximumFractionDigits: digits === undefined ? 1 : digits });
  }

  /* المسافة بين نقطتين بالمتر — صيغة هافرساين */
  function distance(lat1, lng1, lat2, lng2) {
    if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return null;
    var R = 6371000;
    var toRad = Math.PI / 180;
    var dLat = (lat2 - lat1) * toRad;
    var dLng = (lng2 - lng1) * toRad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }

  function fmtDistance(m) {
    if (m == null) return '—';
    if (m < 1000) return m + ' م';
    return (m / 1000).toFixed(m < 10000 ? 2 : 1) + ' كم';
  }

  /* استخراج إحداثيات من رابط جوجل مابس أو نص "30.09, 31.32" */
  function parseCoords(text) {
    if (!text) return null;
    text = String(text).trim();
    var pats = [
      /@(-?\d+\.\d+),\s*(-?\d+\.\d+)/,          // .../@30.089,31.328,17z
      /[?&]q=(-?\d+\.\d+),\s*(-?\d+\.\d+)/,      // ...?q=30.089,31.328
      /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,          // ...!3d30.089!4d31.328
      /^\s*(-?\d+\.\d+)\s*[, ]\s*(-?\d+\.\d+)\s*$/
    ];
    for (var i = 0; i < pats.length; i++) {
      var m = text.match(pats[i]);
      if (m) {
        var la = parseFloat(m[1]), ln = parseFloat(m[2]);
        if (la >= -90 && la <= 90 && ln >= -180 && ln <= 180) return { lat: la, lng: ln };
      }
    }
    return null;
  }

  /* ---------------- المخزن ---------------- */

  var NS = 'amb_v1_';

  var COLLECTIONS = ['vehicles', 'staff', 'venues', 'assignments',
                     'attendance', 'maintenance', 'fuel', 'incidents', 'tracks', 'payouts'];

  var Store = {
    _cache: {},
    _listeners: [],

    load: function (col) {
      if (this._cache[col]) return this._cache[col];
      var raw = null;
      try { raw = localStorage.getItem(NS + col); } catch (e) { }
      var arr = [];
      if (raw) { try { arr = JSON.parse(raw) || []; } catch (e) { arr = []; } }
      this._cache[col] = arr;
      return arr;
    },

    save: function (col) {
      try {
        localStorage.setItem(NS + col, JSON.stringify(this._cache[col] || []));
      } catch (e) {
        console.warn('تعذر الحفظ محلياً', e);
        toast('مساحة التخزين ممتلئة — اعمل نسخة احتياطية وامسح السجلات القديمة', 'error');
      }
    },

    /* كل السجلات غير المحذوفة */
    all: function (col) {
      return this.load(col).filter(function (r) { return !r._del; });
    },

    /* بما فيها المحذوفة — للمزامنة والنسخ الاحتياطي */
    raw: function (col) { return this.load(col); },

    byId: function (col, id) {
      var list = this.load(col);
      for (var i = 0; i < list.length; i++) if (list[i]._id === id) return list[i];
      return null;
    },

    /* إضافة أو تعديل */
    put: function (col, obj, opts) {
      opts = opts || {};
      var list = this.load(col);
      if (!obj._id) obj._id = uid(col.slice(0, 3));
      if (!opts.keepTs) obj._ts = Date.now();
      var found = false;
      for (var i = 0; i < list.length; i++) {
        if (list[i]._id === obj._id) { list[i] = obj; found = true; break; }
      }
      if (!found) list.push(obj);
      this.save(col);
      if (!opts.silent) { this._emit(col); Sync.push(col, obj); }
      return obj;
    },

    /* حفظ مجموعة سجلات دفعة واحدة — كتابة واحدة وإشعار واحد بدل عشرات */
    putBatch: function (col, records) {
      var list = this.load(col);
      var idx = {};
      list.forEach(function (r, i) { idx[r._id] = i; });
      records.forEach(function (obj) {
        if (!obj._id) obj._id = uid(col.slice(0, 3));
        obj._ts = Date.now();
        if (idx[obj._id] !== undefined) list[idx[obj._id]] = obj;
        else { idx[obj._id] = list.length; list.push(obj); }
      });
      this.save(col);
      records.forEach(function (obj) { Sync.push(col, obj); });
      this._emit(col);
      return records.length;
    },

    /* حذف ناعم — نحتفظ بعلامة عشان المزامنة تعرف تحذف من الأجهزة التانية */
    remove: function (col, id) {
      var rec = this.byId(col, id);
      if (!rec) return;
      // نفرّغ الحقول ونسيب العلامة فقط
      for (var k in rec) if (k !== '_id') delete rec[k];
      rec._del = true;
      rec._ts = Date.now();
      this.save(col);
      this._emit(col);
      Sync.push(col, rec);
    },

    /* تعديل حقول محددة بس — بدون ما نلمس باقي السجل.
       مهم للأجهزة اللي عندها نسخة منقوصة (موبايل السائق مثلاً):
       لو رفع السجل كامل هيمسح الحقول اللي مش شايفها. */
    patch: function (col, id, fields) {
      var rec = this.byId(col, id);
      if (!rec) return null;
      var payload = {};
      Object.keys(fields).forEach(function (k) { payload[k] = fields[k]; });
      payload._id = id;
      payload._ts = Date.now();
      Object.keys(payload).forEach(function (k) { rec[k] = payload[k]; });
      this.save(col);
      this._emit(col);
      Sync.patchRemote(col, id, payload);
      return rec;
    },

    /* دمج حقول جاية من تحديث جزئي */
    mergeFields: function (col, id, fields) {
      var list = this.load(col);
      for (var i = 0; i < list.length; i++) {
        if (list[i]._id === id) {
          if ((fields._ts || 0) >= (list[i]._ts || 0)) {
            Object.keys(fields).forEach(function (k) { list[i][k] = fields[k]; });
            this.save(col);
            return true;
          }
          return false;
        }
      }
      if (fields._id) { list.push(fields); this.save(col); return true; }
      return false;
    },

    /* دمج سجل قادم من المزامنة — الأحدث يفوز */
    merge: function (col, rec) {
      if (!rec || !rec._id) return false;
      var list = this.load(col);
      for (var i = 0; i < list.length; i++) {
        if (list[i]._id === rec._id) {
          if ((rec._ts || 0) > (list[i]._ts || 0)) { list[i] = rec; this.save(col); return true; }
          return false;
        }
      }
      list.push(rec);
      this.save(col);
      return true;
    },

    onChange: function (fn) { this._listeners.push(fn); },
    _emit: function (col) {
      this._listeners.forEach(function (fn) { try { fn(col); } catch (e) { console.error(e); } });
    },

    /* الإعدادات */
    settings: function () {
      var raw = null;
      try { raw = localStorage.getItem(NS + 'settings'); } catch (e) { }
      var s = {};
      if (raw) { try { s = JSON.parse(raw) || {}; } catch (e) { } }
      if (!s.garage) s.garage = { name: 'الجراج', lat: null, lng: null, radius: 200 };
      if (s.defaultRadius == null) s.defaultRadius = 200;
      if (s.pingSeconds == null) s.pingSeconds = 20;
      if (s.company == null) s.company = 'شركة الإسعاف';
      if (s.lateGraceMin == null) s.lateGraceMin = 15;   // يُعتبر متأخراً بعد كام دقيقة من موعد الوصول
      if (s.arriveBeforeMin == null) s.arriveBeforeMin = 30; // المفروض يوصل قبل المباراة بكام دقيقة
      if (s.weekStart == null) s.weekStart = 6;          // الأسبوع يبدأ السبت
      if (s.defaultRates == null) s.defaultRates = {};   // أجر المباراة الافتراضي لكل وظيفة
      if (s.autoBonus == null) s.autoBonus = false;      // بونص تلقائي لكل مباراة
      if (s.bonusPerJob == null) s.bonusPerJob = 0;      // قيمته العامة
      if (s.defaultBonuses == null) s.defaultBonuses = {}; // أو حسب الوظيفة
      if (s.bonusRule == null) s.bonusRule = 'done';     // done | attended | ontime
      return s;
    },

    saveSettings: function (s, opts) {
      opts = opts || {};
      if (!opts.keepTs) s._ts = Date.now();
      s._id = 'main';
      try { localStorage.setItem(NS + 'settings', JSON.stringify(s)); } catch (e) { }
      this._emit('settings');
      /* الإعدادات كانت محلية لكل جهاز — عشان كده اسم الشركة والجراج والأجور
         كانوا بيختلفوا من جهاز لجهاز. دلوقتي بيترفعوا زي أي بيانات تانية. */
      if (!opts.silent) Sync.push('settings', s);
    },

    exportAll: function () {
      var out = { _app: 'ambulance-system', _v: 1, _at: Date.now(), settings: this.settings() };
      COLLECTIONS.forEach(function (c) { out[c] = Store.raw(c); });
      return out;
    },

    importAll: function (data, mode) {
      if (!data || data._app !== 'ambulance-system') throw new Error('الملف ليس نسخة احتياطية صالحة');
      var added = 0;
      COLLECTIONS.forEach(function (c) {
        var incoming = data[c] || [];
        if (mode === 'replace') {
          Store._cache[c] = incoming;
          Store.save(c);
          added += incoming.length;
        } else {
          incoming.forEach(function (r) { if (Store.merge(c, r)) added++; });
        }
      });
      if (data.settings) this.saveSettings(data.settings);
      this._emit('*');
      return added;
    },

    wipe: function () {
      COLLECTIONS.forEach(function (c) {
        Store._cache[c] = [];
        try { localStorage.removeItem(NS + c); } catch (e) { }
      });
      this._emit('*');
    },

    /* نقاط المسار بتتراكم بسرعة — نمسح القديم محلياً عشان التخزين ميتملاش.
       ده تنظيف محلي فقط؛ النسخة اللي على السحابة بتفضل. */
    pruneTracks: function (days) {
      var cutoff = Date.now() - (days || 10) * 86400000;
      var list = this.load('tracks');
      var kept = list.filter(function (r) { return (r.ts || 0) >= cutoff; });
      if (kept.length === list.length) return 0;
      var removed = list.length - kept.length;
      this._cache['tracks'] = kept;
      this.save('tracks');
      return removed;
    }
  };

  /* ---------------- المزامنة عبر Firebase (REST + بث حي) ---------------- */
  /* لا نستخدم أي SDK — مجرد fetch و EventSource على واجهة REST القياسية */

  var Sync = {
    cfg: null,
    token: null,
    tokenExp: 0,
    refreshToken: null,
    status: 'off',      // off | connecting | live | error
    streams: {},
    queue: [],
    _statusListeners: [],

    /* إعداد مدمج — عشان أي جهاز يفتح الرابط يتوصّل لوحده من غير ما حد يكتب حاجة.
       الحماية من القواعد في Firebase مش من إخفاء المفتاح (ده مفتاح ويب عام بطبيعته). */
    DEFAULT_CFG: {
      databaseURL: 'https://ambulance-system-11fbc-default-rtdb.europe-west1.firebasedatabase.app',
      apiKey: 'AIzaSyAKFNIjAsaVSBvN2TUSxevTtmQe2oEspLc'
    },

    config: function () {
      if (this.cfg) return this.cfg;
      var raw = null;
      try { raw = localStorage.getItem(NS + 'fb'); } catch (e) { }
      if (raw) {
        try { this.cfg = JSON.parse(raw); } catch (e) { this.cfg = null; }
      }
      /* لو مفيش إعداد محفوظ على الجهاز ده، استخدم المدمج */
      if (!this.cfg || !this.cfg.databaseURL || !this.cfg.apiKey) {
        this.cfg = this.DEFAULT_CFG;
      }
      return this.cfg;
    },

    setConfig: function (cfg) {
      this.cfg = cfg;
      try {
        if (cfg) localStorage.setItem(NS + 'fb', JSON.stringify(cfg));
        else localStorage.removeItem(NS + 'fb');
      } catch (e) { }
    },

    onStatus: function (fn) { this._statusListeners.push(fn); },
    _setStatus: function (s, msg) {
      this.status = s; this.statusMsg = msg || '';
      this._statusListeners.forEach(function (fn) { try { fn(s, msg); } catch (e) { } });
    },

    dbUrl: function (path) {
      var c = this.config();
      if (!c) return null;
      var base = c.databaseURL.replace(/\/+$/, '');
      var url = base + '/' + path + '.json';
      if (this.token) url += (url.indexOf('?') > -1 ? '&' : '?') + 'auth=' + encodeURIComponent(this.token);
      return url;
    },

    /* دخول مجهول — لا يحتاج بريد ولا كلمة سر، ويسمح بقواعد أمان محترمة */
    signIn: function () {
      var c = this.config();
      if (!c || !c.apiKey) return Promise.resolve(null);
      var self = this;
      return fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + encodeURIComponent(c.apiKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnSecureToken: true })
      }).then(function (r) {
        if (!r.ok) return r.json().then(function (e) {
          throw new Error((e.error && e.error.message) || 'فشل الدخول');
        });
        return r.json();
      }).then(function (d) {
        self.token = d.idToken;
        self.refreshToken = d.refreshToken;
        self.tokenExp = Date.now() + (Number(d.expiresIn || 3600) - 300) * 1000;
        return d.idToken;
      });
    },

    ensureToken: function () {
      var c = this.config();
      if (!c || !c.apiKey) return Promise.resolve(null);
      if (this.token && Date.now() < this.tokenExp) return Promise.resolve(this.token);
      if (this.refreshToken) {
        var self = this;
        return fetch('https://securetoken.googleapis.com/v1/token?key=' + encodeURIComponent(c.apiKey), {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(this.refreshToken)
        }).then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('تعذر تجديد الجلسة')); })
          .then(function (d) {
            self.token = d.id_token;
            self.refreshToken = d.refresh_token;
            self.tokenExp = Date.now() + (Number(d.expires_in || 3600) - 300) * 1000;
            return self.token;
          }).catch(function () { return self.signIn(); });
      }
      return this.signIn();
    },

    /* الاتصال وفتح البث الحي للمجموعات المطلوبة */
    /* fetch بمهلة إجبارية.
       من غيرها الطلب ممكن يفضل معلّق للأبد على الشبكات المتقطعة، فلا الـ then
       ولا الـ catch بيشتغلوا — والسجل بيضيع من غير ما يترفع ومن غير ما يدخل
       طابور إعادة المحاولة. ده كان أخطر عيب في المزامنة. */
    fetchT: function (url, opts, ms) {
      return new Promise(function (resolve, reject) {
        var done = false;
        var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        if (ctl) { opts = opts || {}; opts.signal = ctl.signal; }
        var timer = setTimeout(function () {
          if (done) return;
          done = true;
          if (ctl) { try { ctl.abort(); } catch (e) { } }
          reject(new Error('انتهت المهلة'));
        }, ms || 15000);
        fetch(url, opts).then(function (r) {
          if (done) return;
          done = true; clearTimeout(timer); resolve(r);
        }).catch(function (e) {
          if (done) return;
          done = true; clearTimeout(timer); reject(e);
        });
      });
    },

    /* طلب حقيقي صغير لقاعدة البيانات بمهلة — بيفرّق بين «الشبكة شغالة»
       و«القاعدة بترد». بعض الشبكات بتسيب الطلب معلّق للأبد من غير خطأ،
       فالمهلة ضرورية عشان مانفضلش مستنيين رد مش جاي. */
    probe: function (ms) {
      var self = this;
      var url = this.dbUrl('fleet') + '&shallow=true';
      return new Promise(function (resolve) {
        var done = false;
        var timer = setTimeout(function () {
          if (!done) { done = true; resolve(false); }
        }, ms || 12000);
        fetch(url).then(function (r) {
          if (done) return;
          done = true; clearTimeout(timer); resolve(!!r && r.ok);
        }).catch(function () {
          if (done) return;
          done = true; clearTimeout(timer); resolve(false);
        });
      });
    },

    connect: function (collections) {
      var c = this.config();
      if (!c || !c.databaseURL) { this._setStatus('off'); return Promise.resolve(false); }
      var self = this;
      this._setStatus('connecting');
      var cols = collections || COLLECTIONS;
      return this.ensureToken().then(function () {
        /* اختبار حقيقي قبل ما نقول «مباشر».
           من غيره الحالة كانت بتبقى live لمجرد إن التوكن اتجاب، حتى لو الجهاز
           مش بيوصل لقاعدة البيانات أصلاً — فالمستخدم يفتكر إنه بيزامن وهو لأ. */
        return self.probe().then(function (okNet) {
          if (!okNet) {
            self._setStatus('error', 'الجهاز ده مش بيوصل لقاعدة البيانات — الشغل عليه محلي مش مشترك');
            return false;
          }
          cols.forEach(function (col) { self.stream(col); });
          self._setStatus('live');
          self.flush();
        /* رفع أولي: أي سجل موجود على الجهاز ده ومش موجود في السحابة يترفع.
           بيحل مشكلة البيانات اللي اتعملت والمزامنة لسه واقفة — كانت بتفضل
           محلية للأبد لأن الرفع بيحصل وقت التعديل بس. */
          self.syncUpMissing(cols);
          self.syncSettings();
          self.stream('settings');
          // تجديد الجلسة دورياً وإعادة فتح البث
          clearInterval(self._renew);
          self._renew = setInterval(function () {
            if (Date.now() > self.tokenExp - 60000) {
              self.ensureToken().then(function () {
                Object.keys(self.streams).forEach(function (col) { self.stream(col, true); });
              });
            }
          }, 60000);
          return true;
        });
      }).catch(function (err) {
        console.error(err);
        self._setStatus('error', err.message);
        return false;
      });
    },

    disconnect: function () {
      var self = this;
      Object.keys(this.streams).forEach(function (col) {
        try { self.streams[col].close(); } catch (e) { }
      });
      this.streams = {};
      clearInterval(this._renew);
      this._setStatus('off');
    },

    /* بث حي عبر Server-Sent Events — يوصل التغيير فوراً بدون تحديث الصفحة */
    stream: function (col, force) {
      var url = this.dbUrl('fleet/' + col);
      if (!url) return;
      if (this.streams[col]) {
        if (!force) return;
        try { this.streams[col].close(); } catch (e) { }
      }
      var self = this;
      var es = new EventSource(url);
      this.streams[col] = es;

      es.addEventListener('put', function (e) { self._apply(col, e.data, false); });
      es.addEventListener('patch', function (e) { self._apply(col, e.data, true); });
      es.addEventListener('auth_revoked', function () {
        self.ensureToken().then(function () { self.stream(col, true); });
      });
      es.onerror = function () {
        if (self.status === 'live') self._setStatus('error', 'انقطع الاتصال — جاري إعادة المحاولة');
      };
      es.onopen = function () { if (self.status !== 'live') self._setStatus('live'); };
    },

    /* منقّي اختياري بتحطه الصفحة — بيشيل حقول من السجل قبل ما تتخزن على الجهاز.
       صفحة السائق بتستخدمه عشان بيانات الفلوس ما تتحفظش على موبايله أصلاً. */
    sanitize: null,

    _clean: function (col, rec) {
      if (!this.sanitize || !rec || typeof rec !== 'object') return rec;
      return this.sanitize(col, rec) || rec;
    },

    _apply: function (col, dataStr, isPatch) {
      var msg;
      try { msg = JSON.parse(dataStr); } catch (e) { return; }
      var path = msg.path || '/';
      var data = msg.data;
      var changed = false;
      var self = this;

      /* الإعدادات سجل واحد — مش بتمر على Store.merge بتاع القوايم */
      if (col === 'settings') {
        var inc = (path === '/') ? (data && data.main) : data;
        if (inc && inc._id) {
          var cur = Store.settings();
          if ((inc._ts || 0) > (cur._ts || 0)) {
            Store.saveSettings(inc, { keepTs: true, silent: true });
            Store._emit('settings');
          }
        }
        return;
      }

      if (path === '/') {
        // لقطة كاملة للمجموعة
        if (data && typeof data === 'object') {
          Object.keys(data).forEach(function (k) {
            if (Store.merge(col, self._clean(col, data[k]))) changed = true;
          });
        }
      } else if (data && typeof data === 'object') {
        var id = path.replace(/^\//, '').split('/')[0];
        if (isPatch) {
          // تحديث جزئي — ندمج الحقول بس من غير ما نمسح الباقي
          if (Store.mergeFields(col, id, self._clean(col, data))) changed = true;
        } else if (data._id) {
          if (Store.merge(col, self._clean(col, data))) changed = true;
        }
      }
      if (changed) Store._emit(col);
    },

    /* رفع تعديل جزئي */
    patchRemote: function (col, id, fields) {
      if (!this.config() || !id) return;
      var self = this;
      this.ensureToken().then(function () {
        return fetch(self.dbUrl('fleet/' + col + '/' + id), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fields)
        });
      }).then(function (r) {
        if (!r || !r.ok) throw new Error('فشل الرفع');
      }).catch(function () {
        self.queue.push({ col: col, id: id, fields: fields, isPatch: true });
        self._saveQueue();
      });
    },

    /* رفع سجل — لو النت مقطوع نحطه في الطابور */
    push: function (col, rec) {
      if (!this.config() || !rec || !rec._id) return Promise.resolve(false);
      var self = this;
      /* قفل لكل سجل — لو نفس السجل اتبعت وهو لسه طاير، مانبعتوش تاني.
         من غيره الطلبات بتتكدس والطابور بيتكرر. */
      this._inflight = this._inflight || {};
      var k = col + '/' + rec._id;
      if (this._inflight[k]) return this._inflight[k];
      var p = this.ensureToken().then(function () {
        var url = self.dbUrl('fleet/' + col + '/' + rec._id);
        return self.fetchT(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(rec)
        });
      }).then(function (r) {
        if (!r || !r.ok) throw new Error('فشل الرفع');
        self._unqueue(col, rec._id);
        /* الرفع نجح — لازم الحالة ترجع «مباشر».
           من غير السطر ده كانت أول تأخيرة بتسيب اللافتة ظاهرة للأبد. */
        if (!self.queue.length && self.status !== 'live') self._setStatus('live');
        return true;
      }).catch(function () {
        /* المهلة بتضمن إننا نوصل هنا حتى لو الشبكة سابت الطلب معلّق.
           مابنصرّخش من أول تأخيرة — الشبكة المتقطعة بتنجح من التانية غالباً.
           التحذير بيظهر بس لما السجل يفضل عالق فترة (شوف stuckFor). */
        self._enqueue({ col: col, rec: rec });
        self._notify();
        return false;
      }).then(function (ok) {
        delete self._inflight[k];
        return ok;
      });
      this._inflight[k] = p;
      return p;
    },

    /* الطابور: سجل واحد لكل معرّف — الأحدث بيستبدل الأقدم.
       بنحتفظ بوقت أول محاولة عشان نعرف السجل عالق من امتى. */
    _enqueue: function (item) {
      var id = item.rec && item.rec._id;
      var since = 0;
      if (id) this.queue = this.queue.filter(function (q) {
        if (q.col === item.col && q.rec && q.rec._id === id) { since = q._since || 0; return false; }
        return true;
      });
      item._since = since || Date.now();
      this.queue.push(item);
      this._saveQueue();
    },

    _unqueue: function (col, id) {
      var before = this.queue.length;
      this.queue = this.queue.filter(function (q) {
        return !(q.col === col && q.rec && q.rec._id === id);
      });
      if (this.queue.length !== before) { this._saveQueue(); this._notify(); }
    },

    pending: function () { return (this.queue || []).length; },

    /* أقدم سجل عالق من كام ثانية — التحذير بيتبني عليه مش على أول فشل */
    stuckFor: function () {
      var q = this.queue || [];
      if (!q.length) return 0;
      var oldest = Math.min.apply(null, q.map(function (x) { return x._since || Date.now(); }));
      return Math.round((Date.now() - oldest) / 1000);
    },

    /* بلّغ الواجهة إن الطابور اتغير من غير ما نغيّر الحالة */
    _notify: function () {
      var self = this;
      this._statusListeners.forEach(function (fn) {
        try { fn(self.status, self.statusMsg); } catch (e) { }
      });
    },

    _saveQueue: function () {
      try { localStorage.setItem(NS + 'queue', JSON.stringify(this.queue.slice(-500))); } catch (e) { }
    },

    _loadQueue: function () {
      try {
        var raw = localStorage.getItem(NS + 'queue');
        this.queue = raw ? JSON.parse(raw) : [];
      } catch (e) { this.queue = []; }
    },

    /* إفراغ الطابور لما النت يرجع */
    flush: function () {
      if (!this.config() || !this.queue.length || this._flushing) return;
      var self = this;
      this._flushing = true;
      /* مابنفضّيش الطابور قبل التأكد — كل عنصر بيخرج منه لما يرفع بنجاح فقط
         (push بينادي _unqueue). لو الصفحة اتقفلت في النص، البيانات لسه محفوظة. */
      var batch = this.queue.slice();
      return Promise.all(batch.map(function (item) {
        if (item.isPatch) return Promise.resolve(self.patchRemote(item.col, item.id, item.fields));
        return self.push(item.col, item.rec);
      })).then(function () {
        self._flushing = false;
        if (!self.queue.length && self.status === 'error') self._setStatus('live');
        return self.queue.length;
      }).catch(function () { self._flushing = false; return self.queue.length; });
    },

    /* سحب كامل مرة واحدة — للصفحات اللي مش محتاجة بث حي */
    /* يقارن المحلي بالسحابي ويرفع الناقص بس — إضافة فقط، مابيمسحش ومابيدهسش
       أي سجل موجود في السحابة، فآمن إنه يشتغل على أي جهاز في أي وقت. */
    syncUpMissing: function (collections) {
      var self = this;
      var cols = collections || COLLECTIONS;
      var pushed = 0;
      return this.ensureToken().then(function () {
        return Promise.all(cols.map(function (col) {
          var local = Store.all(col) || [];
          if (!local.length) return Promise.resolve();
          return self.fetchT(self.dbUrl('fleet/' + col) + '&shallow=true', null, 15000)
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (remote) {
              if (remote === null) return;      /* مقدرناش نقرأ — نستنى، أحسن من رفع أعمى */
              var have = remote || {};
              var missing = local.filter(function (rec) { return rec && rec._id && !have[rec._id]; });
              if (!missing.length) return;
              /* بنعدّ النجاح الفعلي مش النية — العدّاد كان بيتزود قبل ما الرفع يخلص */
              return Promise.all(missing.map(function (rec) {
                return self.push(col, rec).then(function (ok) { if (ok) pushed++; });
              }));
            }).catch(function () { });
        }));
      }).then(function () {
        if (pushed) {
          self._setStatus('live', 'اترفع ' + pushed + ' سجل كان محلي');
          try { global.AMB && AMB.toast && AMB.toast('✓ اترفع ' + pushed + ' سجل كان محفوظ على الجهاز ده بس', 'ok'); } catch (e) { }
        }
        return pushed;
      }).catch(function () { return 0; });
    },

    /* الإعدادات سجل واحد مش قايمة، فليها مسار خاص.
       الأحدث بالتوقيت هو اللي يكسب — نفس منطق باقي السجلات. */
    syncSettings: function () {
      var self = this;
      return this.ensureToken().then(function () {
        return self.fetchT(self.dbUrl('fleet/settings/main'), null, 15000);
      }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (remote) {
          var local = Store.settings();
          if (remote && remote._id) {
            if ((remote._ts || 0) > (local._ts || 0)) {
              Store.saveSettings(remote, { keepTs: true, silent: true });
              Store._emit('settings');
              return 'نزلت';
            }
            if ((local._ts || 0) > (remote._ts || 0)) { self.push('settings', local); return 'اترفعت'; }
            return 'متطابقة';
          }
          /* مفيش إعدادات في السحابة — ارفع بتاعت الجهاز ده */
          self.push('settings', local);
          return 'اترفعت أول مرة';
        }).catch(function () { return 'فشلت'; });
    },

    pullOnce: function (col) {
      var self = this;
      return this.ensureToken().then(function () {
        return fetch(self.dbUrl('fleet/' + col));
      }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          var changed = false;
          if (data) Object.keys(data).forEach(function (k) {
            if (Store.merge(col, self._clean(col, data[k]))) changed = true;
          });
          if (changed) Store._emit(col);
          return changed;
        }).catch(function () { return false; });
    }
  };

  Sync._loadQueue();
  global.addEventListener && global.addEventListener('online', function () { Sync.flush(); });

  /* إعادة محاولة دورية — على الشبكات المتقطعة الطلب بينجح من التالتة أو الرابعة.
     من غير ده السجل اللي فشل بيفضل في الطابور لحد ما المستخدم يعمل تعديل تاني. */
  setInterval(function () {
    if (Sync.pending && Sync.pending() && Sync.config()) Sync.flush();
  }, 15000);

  /* ---------------- الموقع الجغرافي ---------------- */

  var Geo = {
    supported: function () { return 'geolocation' in navigator; },

    once: function (opts) {
      return new Promise(function (resolve, reject) {
        if (!navigator.geolocation) return reject(new Error('الجهاز لا يدعم تحديد الموقع'));
        navigator.geolocation.getCurrentPosition(
          function (p) {
            resolve({
              lat: p.coords.latitude, lng: p.coords.longitude,
              acc: Math.round(p.coords.accuracy || 0),
              speed: p.coords.speed == null ? null : Math.round(p.coords.speed * 3.6),
              heading: p.coords.heading == null ? null : Math.round(p.coords.heading),
              ts: p.timestamp || Date.now()
            });
          },
          function (err) { reject(new Error(Geo.errText(err))); },
          Object.assign({ enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }, opts || {})
        );
      });
    },

    watch: function (cb, errCb) {
      if (!navigator.geolocation) { errCb && errCb(new Error('الجهاز لا يدعم تحديد الموقع')); return null; }
      return navigator.geolocation.watchPosition(
        function (p) {
          cb({
            lat: p.coords.latitude, lng: p.coords.longitude,
            acc: Math.round(p.coords.accuracy || 0),
            speed: p.coords.speed == null ? null : Math.round(p.coords.speed * 3.6),
            heading: p.coords.heading == null ? null : Math.round(p.coords.heading),
            ts: p.timestamp || Date.now()
          });
        },
        function (err) { errCb && errCb(new Error(Geo.errText(err))); },
        { enableHighAccuracy: true, timeout: 30000, maximumAge: 5000 }
      );
    },

    clear: function (id) { if (id != null && navigator.geolocation) navigator.geolocation.clearWatch(id); },

    errText: function (err) {
      if (!err) return 'خطأ غير معروف';
      if (err.code === 1) return 'رفضت إذن الموقع — افتح إعدادات المتصفح واسمح بالوصول للموقع';
      if (err.code === 2) return 'تعذر تحديد الموقع — تأكد أن الـ GPS مفتوح وأنك في مكان مكشوف';
      if (err.code === 3) return 'انتهت المهلة — حاول مرة أخرى';
      return err.message || 'خطأ في تحديد الموقع';
    }
  };

  /* ---------------- تنبيهات على الشاشة ---------------- */

  function toast(msg, kind, ms) {
    var host = document.getElementById('toasts');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toasts';
      document.body.appendChild(host);
    }
    var t = document.createElement('div');
    t.className = 'toast ' + (kind || 'info');
    t.textContent = msg;
    host.appendChild(t);
    setTimeout(function () {
      t.classList.add('out');
      setTimeout(function () { t.remove(); }, 300);
    }, ms || (kind === 'error' ? 6000 : 3200));
  }

  /* ---------------- منطق المجال (مشترك بين المدير والسائق) ---------------- */

  var Model = {

    vehicleName: function (id) {
      var v = Store.byId('vehicles', id);
      return v && !v._del ? v.name : '—';
    },

    staffName: function (id) {
      var s = Store.byId('staff', id);
      return s && !s._del ? s.name : '—';
    },

    venueName: function (id) {
      var v = Store.byId('venues', id);
      return v && !v._del ? v.name : '—';
    },

    venue: function (id) {
      var v = Store.byId('venues', id);
      return v && !v._del ? v : null;
    },

    /* مين بيتحسب في تقارير الحضور والانصراف.
       السواقين والفنيين مستثنيين افتراضياً — حركتهم بتتسجّل كحركة سيارة مش حضور،
       ويقدر المدير يغيّر ده لأي فرد من شاشة الأفراد. */
    NO_ATTENDANCE_ROLES: { 'سائق': true, 'فني': true },

    countsAttendance: function (staffId) {
      var s = Store.byId('staff', staffId);
      if (!s || s._del) return false;
      if (s.countsAttendance === true) return true;
      if (s.countsAttendance === false) return false;
      return !Model.NO_ATTENDANCE_ROLES[s.role];
    },

    /* مهام يوم معين مرتبة بالوقت */
    assignmentsOn: function (iso) {
      return Store.all('assignments')
        .filter(function (a) { return a.date === iso; })
        .sort(function (a, b) { return (a.time || '').localeCompare(b.time || ''); });
    },

    assignmentsBetween: function (fromIso, toIso) {
      return Store.all('assignments').filter(function (a) {
        return a.date >= fromIso && a.date <= toIso;
      }).sort(function (a, b) {
        return (a.date + a.time).localeCompare(b.date + b.time);
      });
    },

    /* المهمة الحالية أو القادمة لعربية معينة */
    currentAssignment: function (vehicleId) {
      var t = today();
      var list = this.assignmentsOn(t).filter(function (a) {
        return a.vehicleId === vehicleId && a.status !== 'ملغاة';
      });
      // الجارية أولاً
      for (var i = 0; i < list.length; i++) if (list[i].status === 'جارية') return list[i];
      for (var j = 0; j < list.length; j++) if (list[j].status !== 'منتهية') return list[j];
      return null;
    },

    /* كشف تعارض: نفس العربية في مهمتين متقاربتين */
    conflicts: function (assignment) {
      if (!assignment.vehicleId || !assignment.date || !assignment.time) return [];
      var mins = function (t) { var p = t.split(':'); return (+p[0]) * 60 + (+p[1] || 0); };
      var start = mins(assignment.time);
      var dur = Number(assignment.duration) || 120;
      var self = this;
      return this.assignmentsOn(assignment.date).filter(function (a) {
        if (a._id === assignment._id) return false;
        if (a.vehicleId !== assignment.vehicleId) return false;
        if (a.status === 'ملغاة') return false;
        if (!a.time) return false;
        var s2 = mins(a.time), d2 = Number(a.duration) || 120;
        return start < s2 + d2 && s2 < start + dur;
      });
    },

    /* تعارض طاقم: نفس الفرد في مهمتين */
    crewConflicts: function (assignment) {
      var crew = assignment.crew || [];
      if (!crew.length || !assignment.date || !assignment.time) return [];
      var mins = function (t) { var p = t.split(':'); return (+p[0]) * 60 + (+p[1] || 0); };
      var start = mins(assignment.time);
      var dur = Number(assignment.duration) || 120;
      var out = [];
      this.assignmentsOn(assignment.date).forEach(function (a) {
        if (a._id === assignment._id || a.status === 'ملغاة' || !a.time) return;
        var s2 = mins(a.time), d2 = Number(a.duration) || 120;
        if (!(start < s2 + d2 && s2 < start + dur)) return;
        var shared = (a.crew || []).filter(function (id) { return crew.indexOf(id) > -1; });
        if (shared.length) out.push({ assignment: a, staff: shared });
      });
      return out;
    },

    /* آخر إشارة موقع لعربية */
    lastPing: function (vehicleId) {
      var t = Store.all('tracks').filter(function (r) { return r.vehicleId === vehicleId; });
      if (!t.length) return null;
      return t.reduce(function (a, b) { return (a.ts || 0) > (b.ts || 0) ? a : b; });
    },

    /* مسار عربية خلال فترة */
    track: function (vehicleId, fromTs, toTs) {
      return Store.all('tracks').filter(function (r) {
        return r.vehicleId === vehicleId && r.ts >= fromTs && r.ts <= (toTs || Date.now());
      }).sort(function (a, b) { return a.ts - b.ts; });
    },

    /* سجلات حضور مهمة */
    attendanceFor: function (assignmentId) {
      return Store.all('attendance')
        .filter(function (r) { return r.assignmentId === assignmentId; })
        .sort(function (a, b) { return a.ts - b.ts; });
    },

    /* آخر عداد معروف لعربية (من التفويل أو الصيانة) */
    odometer: function (vehicleId) {
      var best = 0;
      Store.all('fuel').forEach(function (f) {
        if (f.vehicleId === vehicleId && Number(f.odometer) > best) best = Number(f.odometer);
      });
      Store.all('maintenance').forEach(function (m) {
        if (m.vehicleId === vehicleId && Number(m.odometer) > best) best = Number(m.odometer);
      });
      var v = Store.byId('vehicles', vehicleId);
      if (v && Number(v.odometer) > best) best = Number(v.odometer);
      return best;
    },

    /* متوسط الاستهلاك: كم لكل لتر — يحتاج تعبئتين على الأقل بعدادات مسجلة */
    consumption: function (vehicleId) {
      var f = Store.all('fuel')
        .filter(function (r) { return r.vehicleId === vehicleId && Number(r.odometer) > 0 && Number(r.liters) > 0; })
        .sort(function (a, b) { return Number(a.odometer) - Number(b.odometer); });
      if (f.length < 2) return null;
      var km = Number(f[f.length - 1].odometer) - Number(f[0].odometer);
      // لترات كل التعبئات ما عدا الأولى (الأولى ملّت التانك قبل بداية القياس)
      var liters = 0;
      for (var i = 1; i < f.length; i++) liters += Number(f[i].liters);
      if (km <= 0 || liters <= 0) return null;
      return { kmPerLiter: km / liters, km: km, liters: liters, fills: f.length };
    },

    /* تنبيهات الصيانة المستحقة */
    dueMaintenance: function () {
      var out = [];
      var t = new Date();
      Store.all('maintenance').forEach(function (m) {
        if (m.status === 'تمت' && !m.nextDate && !m.nextKm) return;
        var v = Store.byId('vehicles', m.vehicleId);
        if (!v || v._del) return;
        var odo = Model.odometer(m.vehicleId);

        if (m.nextKm && Number(m.nextKm) > 0) {
          var remain = Number(m.nextKm) - odo;
          if (remain <= 1000) {
            out.push({
              vehicleId: m.vehicleId, record: m,
              reason: remain <= 0 ? 'تجاوزت الموعد بـ ' + num(-remain, 0) + ' كم'
                                  : 'باقي ' + num(remain, 0) + ' كم',
              overdue: remain <= 0, kind: 'كم'
            });
          }
        }
        if (m.nextDate) {
          var d = parseDay(m.nextDate);
          var days = Math.round((d - t) / 86400000);
          if (days <= 14) {
            out.push({
              vehicleId: m.vehicleId, record: m,
              reason: days < 0 ? 'متأخرة ' + (-days) + ' يوم' : (days === 0 ? 'مستحقة اليوم' : 'باقي ' + days + ' يوم'),
              overdue: days < 0, kind: 'تاريخ'
            });
          }
        }
      });
      return out.sort(function (a, b) { return (b.overdue ? 1 : 0) - (a.overdue ? 1 : 0); });
    },

    /* ---------- الأسبوع ومستحقات الفريق ---------- */

    /* حدود الأسبوع اللي واقع فيه تاريخ معيّن.
       weekStart: 0 الأحد ... 6 السبت (الافتراضي السبت زي ما الشغل ماشي هنا) */
    weekRange: function (iso, weekStart) {
      var ws = (weekStart == null) ? 6 : Number(weekStart);
      var d = parseDay(iso) || new Date();
      var diff = (d.getDay() - ws + 7) % 7;
      var from = new Date(d.getFullYear(), d.getMonth(), d.getDate() - diff);
      var to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 6);
      return { from: toISODay(from), to: toISODay(to) };
    },

    shiftWeek: function (range, weeks, weekStart) {
      var d = parseDay(range.from);
      d.setDate(d.getDate() + weeks * 7);
      return this.weekRange(toISODay(d), weekStart);
    },

    /* مباريات فرد معيّن خلال فترة — المكلَّف بيها وغير ملغاة */
    jobsOfStaff: function (staffId, fromIso, toIso) {
      return this.assignmentsBetween(fromIso, toIso).filter(function (a) {
        return a.status !== 'ملغاة' && (a.crew || []).indexOf(staffId) > -1;
      });
    },

    /* أجر المباراة الواحدة للفرد — من بياناته، وإلا الافتراضي حسب الوظيفة */
    rateOf: function (staffId) {
      var s = Store.byId('staff', staffId);
      if (!s || s._del) return 0;
      if (Number(s.ratePerJob) > 0) return Number(s.ratePerJob);
      var st = Store.settings();
      var byRole = st.defaultRates || {};
      return Number(byRole[s.role]) || 0;
    },

    /* بونص المباراة الواحدة — نفس منطق الأجر */
    bonusRateOf: function (staffId) {
      var st = Store.settings();
      if (!st.autoBonus) return 0;
      var s = Store.byId('staff', staffId);
      if (!s || s._del) return 0;
      if (s.bonusPerJob === 0) return 0;                    // صفر صريح = مستثنى
      if (Number(s.bonusPerJob) > 0) return Number(s.bonusPerJob);
      var byRole = st.defaultBonuses || {};
      return Number(byRole[s.role]) || Number(st.bonusPerJob) || 0;
    },

    /* شرح شرط استحقاق البونص */
    bonusRuleText: function (rule) {
      return {
        done:     'كل مباراة انتهت',
        attended: 'كل مباراة انتهت وسجّل فيها حضوره',
        ontime:   'كل مباراة انتهت وسجّل حضوره في الميعاد'
      }[rule || 'done'];
    },

    /* ملخص فرد في أسبوع: كام مباراة، كام حضور متحقق، كام تأخير، والمستحق */
    staffWeek: function (staffId, fromIso, toIso) {
      var st = Store.settings();
      var jobs = this.jobsOfStaff(staffId, fromIso, toIso);
      var attAll = Store.all('attendance');
      var counts = this.countsAttendance(staffId);

      var bonusRate = this.bonusRateOf(staffId);
      var rule = st.bonusRule || 'done';
      var grace = st.lateGraceMin || 15;

      var verified = 0, late = 0, lateMin = 0, outside = 0, bonusJobs = 0;
      var rows = jobs.map(function (j) {
        var recs = attAll.filter(function (r) {
          return r.assignmentId === j._id && r.staffId === staffId;
        });
        var arrive = recs.filter(function (r) { return r.kind === 'arrive_venue'; })[0];
        var depart = recs.filter(function (r) { return r.kind === 'depart_garage'; })[0];
        var showed = !!(arrive || depart);
        if (showed) verified++;

        var lateBy = null;
        if (arrive && counts) {
          var target = parseDay(j.date);
          var tp = (j.time || '00:00').split(':');
          target.setHours(+tp[0], +tp[1] || 0, 0, 0);
          var mustBy = target.getTime() - (st.arriveBeforeMin || 30) * 60000;
          lateBy = Math.round((arrive.ts - mustBy) / 60000);
          if (lateBy > (st.lateGraceMin || 15)) { late++; lateMin += lateBy; }
        }
        if (arrive && arrive.valid === false) outside++;

        /* استحقاق البونص التلقائي */
        var done = (j.status === 'منتهية');
        var earnsBonus = false, whyNot = '';
        if (bonusRate > 0) {
          if (!done) whyNot = 'المباراة لسه ما اتقفلتش';
          else if (rule !== 'done' && !showed) whyNot = 'ما سجّلش حضور';
          else if (rule === 'ontime' && lateBy != null && lateBy > grace) whyNot = 'وصل متأخر';
          else earnsBonus = true;
        }
        if (earnsBonus) bonusJobs++;

        return { job: j, arrive: arrive, depart: depart, showed: showed, lateBy: lateBy,
                 earnsBonus: earnsBonus, whyNoBonus: whyNot };
      });

      var rate = this.rateOf(staffId);
      return {
        staffId: staffId, from: fromIso, to: toIso,
        jobs: jobs.length, verified: verified, missed: jobs.length - verified,
        late: late, avgLate: late ? Math.round(lateMin / late) : 0, outside: outside,
        countsAttendance: counts, rate: rate, earned: jobs.length * rate,
        bonusRate: bonusRate, bonusRule: rule,
        bonusJobs: bonusJobs, autoBonus: bonusJobs * bonusRate,
        rows: rows.sort(function (a, b) {
          return (a.job.date + a.job.time).localeCompare(b.job.date + b.job.time);
        })
      };
    },

    /* هل الأسبوع ده اتصرف للفرد ده؟ */
    payoutFor: function (staffId, fromIso, toIso) {
      var list = Store.all('payouts').filter(function (p) {
        return p.staffId === staffId && p.from === fromIso && p.to === toIso;
      });
      return list.length ? list[0] : null;
    },

    /* ملخص مالي لفترة */
    finance: function (fromIso, toIso) {
      var revenue = 0, jobs = 0;
      this.assignmentsBetween(fromIso, toIso).forEach(function (a) {
        if (a.status === 'ملغاة') return;
        revenue += Number(a.fee) || 0;
        jobs++;
      });
      var fuelCost = 0, liters = 0;
      Store.all('fuel').forEach(function (f) {
        if (f.date >= fromIso && f.date <= toIso) {
          fuelCost += Number(f.total) || 0;
          liters += Number(f.liters) || 0;
        }
      });
      var maintCost = 0;
      Store.all('maintenance').forEach(function (m) {
        if (m.date >= fromIso && m.date <= toIso) maintCost += Number(m.cost) || 0;
      });
      return {
        revenue: revenue, jobs: jobs, fuelCost: fuelCost, liters: liters,
        maintCost: maintCost, expenses: fuelCost + maintCost,
        net: revenue - fuelCost - maintCost
      };
    }
  };

  /* ---------------- بذرة البيانات الأولى ---------------- */

  /* force = true معناها «اعمل البيانات الافتراضية غصب» — بتتستخدم بعد المسح اليدوي بس.
     من غيرها: لو المزامنة متظبطة، السحابة هي المصدر — نستنى السحب بدل ما نعمل
     بيانات محلية تتكرر مع اللي جاي من القاعدة. */
  function seedIfEmpty(force) {
    if (Store.raw('vehicles').length || Store.raw('venues').length) return false;
    if (!force && Sync.config()) return false;

    [
      { name: 'إسعاف 1', plate: '', model: '', year: '', color: '#e63946', status: 'متاح', odometer: 0, fuelType: 'سولار', tankSize: 70 },
      { name: 'إسعاف 2', plate: '', model: '', year: '', color: '#1d75d8', status: 'متاح', odometer: 0, fuelType: 'سولار', tankSize: 70 },
      { name: 'إسعاف 3', plate: '', model: '', year: '', color: '#2a9d5c', status: 'متاح', odometer: 0, fuelType: 'سولار', tankSize: 70 }
    ].forEach(function (v) { Store.put('vehicles', v, { silent: true }); });

    // الأندية من جدولك الحالي — المواقع فاضية عن قصد، تُضبط من داخل النظام
    ['ليفلز', 'الطيران', 'بلاتينيوم', 'هيليوبوليس', 'الشمس', 'الحضارات',
     'الإنتاج الحربي', 'المستعمرة', 'هايكستب', 'مركز شباب السلام',
     'سانتوس', 'الأميرية', 'هيليوليدو'
    ].forEach(function (n) {
      Store.put('venues', {
        name: n, address: '', lat: null, lng: null,
        radius: 200, contact: '', phone: '', defaultFee: 0, notes: ''
      }, { silent: true });
    });

    Store._emit('*');
    return true;
  }

  /* ---------------- التصدير ---------------- */

  global.AMB = {
    AR_DAYS: AR_DAYS, AR_MONTHS: AR_MONTHS, COLLECTIONS: COLLECTIONS,
    uid: uid, esc: esc, toast: toast,
    parseDay: parseDay, toISODay: toISODay, today: today,
    fmtDay: fmtDay, fmtDayShort: fmtDayShort, fmtTime: fmtTime,
    fmtStamp: fmtStamp, fmtClock: fmtClock, ago: ago, fmtMins: fmtMins,
    money: money, num: num, distance: distance, fmtDistance: fmtDistance,
    parseCoords: parseCoords,
    Store: Store, Sync: Sync, Geo: Geo, Model: Model,
    seedIfEmpty: seedIfEmpty
  };

})(window);
