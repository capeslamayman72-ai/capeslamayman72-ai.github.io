/* ============================================================
   طبقة المزامنة عبر Firebase الرسمية (WebSocket)
   ------------------------------------------------------------
   ليه الملف ده موجود:
   الطريقة القديمة كانت بتكلّم قاعدة البيانات بطلبات HTTP عادية
   (fetch + EventSource). على شبكات المستخدم دي الطلبات كانت بتعلّق
   للأبد من غير رد — لا نجاح ولا فشل — فالبيانات كانت بتتبخّر بصمت
   والأجهزة بتختلف عن بعضها.

   الاختبار أثبت إن WebSocket لنفس القاعدة بيفتح في نص ثانية على نفس
   الجهاز والشبكة. فالمشكلة كانت في وسيلة النقل مش في الشبكة ولا القاعدة.

   المكتبة الرسمية كمان بتتكفّل بحاجات كنت بكتبها بإيدي وغلطت فيها:
   إعادة الاتصال، الطابور وقت الانقطاع، الكتابة المحلية الفورية،
   وحل التعارض. إحنا بنستخدمها ونسيب واجهة Sync زي ما هي بالظبط
   عشان dashboard.js و driver.js ما يتغيّروش.
   ============================================================ */
(function (global) {
  'use strict';

  var SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  var loaded = null;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('تعذر تحميل ' + src)); };
      document.head.appendChild(s);
    });
  }

  /* نسخة compat عشان تشتغل من غير bundler ومن غير modules */
  function loadSDK() {
    if (loaded) return loaded;
    loaded = loadScript(SDK + 'firebase-app-compat.js')
      .then(function () { return loadScript(SDK + 'firebase-auth-compat.js'); })
      .then(function () { return loadScript(SDK + 'firebase-database-compat.js'); })
      .then(function () { return global.firebase; });
    return loaded;
  }

  var WS = {
    _app: null,
    _db: null,
    _refs: {},
    _ready: null,
    _localEcho: {},        /* سجلات إحنا كتبناها — عشان ما نعيدش رسمها */

    available: function () { return typeof WebSocket !== 'undefined'; },

    /* يبدأ الاتصال ويربط كل مجموعة ببثها الحي */
    start: function (Sync, Store, COLLECTIONS, cfg, cols) {
      var self = this;
      if (this._ready) return this._ready;

      this._ready = loadSDK().then(function (firebase) {
        if (!firebase) throw new Error('المكتبة ما اتحملتش');

        self._app = firebase.apps && firebase.apps.length
          ? firebase.app()
          : firebase.initializeApp({
              apiKey: cfg.apiKey,
              databaseURL: cfg.databaseURL,
              authDomain: (cfg.databaseURL.match(/https:\/\/([^-]+(?:-[^-]+)*)-default-rtdb/) || [])[1]
                            ? (cfg.databaseURL.match(/https:\/\/(.+?)-default-rtdb/)[1] + '.firebaseapp.com')
                            : undefined
            });

        self._db = firebase.database();

        /* دخول مجهول — نفس اللي كانت بتعمله الطريقة القديمة */
        return firebase.auth().signInAnonymously().then(function () { return firebase; });
      }).then(function (firebase) {

        /* حالة الاتصال الحقيقية من المكتبة نفسها — مش تخمين */
        self._db.ref('.info/connected').on('value', function (snap) {
          if (snap.val() === true) {
            Sync._setStatus('live');
          } else {
            /* مابنصرّخش فوراً — المكتبة بتعيد المحاولة لوحدها */
            if (Sync.status === 'live') Sync._setStatus('connecting', 'بيحاول يوصل');
          }
        });

        (cols || COLLECTIONS).concat(['settings']).forEach(function (col) {
          self.watch(Sync, Store, col);
        });

        return true;
      }).catch(function (err) {
        console.error('WebSocket sync', err);
        self._ready = null;
        throw err;
      });

      return this._ready;
    },

    /* بث حي لمجموعة — كل تغيير من أي جهاز بيوصل فوراً */
    watch: function (Sync, Store, col) {
      var self = this;
      if (this._refs[col]) return;
      var ref = this._db.ref('fleet/' + col);
      this._refs[col] = ref;

      function apply(snap) {
        var rec = snap.val();
        if (!rec || !rec._id) return;
        var k = col + '/' + rec._id;
        /* لو ده صدى كتابتنا إحنا، نتجاهله — اتكتب محلياً بالفعل */
        if (self._localEcho[k] && self._localEcho[k] === rec._ts) {
          delete self._localEcho[k];
          return;
        }
        if (col === 'settings') {
          var cur = Store.settings();
          if ((rec._ts || 0) > (cur._ts || 0)) {
            Store.saveSettings(rec, { keepTs: true, silent: true });
            Store._emit('settings');
          }
          return;
        }
        if (Store.merge(col, Sync._clean(col, rec))) Store._emit(col);
      }

      ref.on('child_added', apply);
      ref.on('child_changed', apply);
    },

    /* كتابة — المكتبة بتحفظها محلياً فوراً وبترفعها أول ما الشبكة تسمح */
    put: function (col, rec) {
      if (!this._db || !rec || !rec._id) return Promise.resolve(false);
      this._localEcho[col + '/' + rec._id] = rec._ts;
      var p = this._db.ref('fleet/' + col + '/' + rec._id).set(rec);
      /* set بيرجع وعد بيتحقق لما السيرفر يأكد. مابنستناهوش عشان الواجهة
         ما تقفش — المكتبة ضامنة التسليم حتى لو الصفحة اتقفلت وفتحت. */
      p.catch(function () { });
      return p.then(function () { return true; }).catch(function () { return false; });
    },

    patch: function (col, id, fields) {
      if (!this._db || !id) return Promise.resolve(false);
      return this._db.ref('fleet/' + col + '/' + id).update(fields)
        .then(function () { return true; }).catch(function () { return false; });
    },

    /* سحب مرة واحدة — للصفحات اللي مش محتاجة بث */
    pull: function (Sync, Store, col) {
      if (!this._db) return Promise.resolve(false);
      return this._db.ref('fleet/' + col).once('value').then(function (snap) {
        var data = snap.val();
        var changed = false;
        if (data) Object.keys(data).forEach(function (k) {
          if (col === 'settings') return;
          if (Store.merge(col, Sync._clean(col, data[k]))) changed = true;
        });
        if (changed) Store._emit(col);
        return changed;
      }).catch(function () { return false; });
    },

    stop: function () {
      var self = this;
      Object.keys(this._refs).forEach(function (c) {
        try { self._refs[c].off(); } catch (e) { }
      });
      this._refs = {};
    }
  };

  global.AMB_WS = WS;

})(window);
