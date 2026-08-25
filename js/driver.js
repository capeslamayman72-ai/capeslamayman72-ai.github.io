/* ============================================================
   صفحة المسعف / السائق — تعمل على الموبايل
   ============================================================ */
(function () {
  'use strict';

  var S = AMB.Store, M = AMB.Model, Sync = AMB.Sync, Geo = AMB.Geo;
  var esc = AMB.esc;

  var CHECKS = [
    { k: 'depart_garage', t: 'خروج من الجراج', ic: '🚪', ref: 'garage', cls: 'go',
      sub: 'اضغط وأنت في الجراج قبل ما تتحرك', next: 'arrive_venue' },
    { k: 'arrive_venue',  t: 'الوصول للملعب',  ic: '📍', ref: 'venue',  cls: 'arrive',
      sub: 'اضغط بعد ما توصل الملعب فعلاً', next: 'leave_venue' },
    { k: 'leave_venue',   t: 'مغادرة الملعب',  ic: '↩',  ref: 'venue',  cls: 'leave',
      sub: 'اضغط لما تخلص المهمة وتتحرك', next: 'return_garage' },
    { k: 'return_garage', t: 'العودة للجراج',  ic: '🏁', ref: 'garage', cls: 'end',
      sub: 'اضغط بعد ما ترجع الجراج', next: null }
  ];
  function checkDef(k) { for (var i = 0; i < CHECKS.length; i++) if (CHECKS[i].k === k) return CHECKS[i]; return null; }

  var LS = 'amb_drv_';
  var me = { staffId: null, vehicleId: null };
  var tab = 'mission';
  var watchId = null, lastPingTs = 0, wakeLock = null;
  var gps = { state: 'off', last: null, err: null };
  var body, ready = false, standalone = false;

  /* ---------------- الإقلاع ---------------- */

  function boot() {
    body = document.getElementById('dBody');

    /* 1) إعدادات الاتصال من الرابط */
    var hash = location.hash.replace(/^#/, '');
    var params = {};
    hash.split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) params[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
    });

    if (params.c) {
      try {
        var cfg = JSON.parse(decodeURIComponent(escape(atob(params.c))));
        if (cfg.databaseURL && cfg.apiKey) {
          Sync.setConfig(cfg);
          Sync.token = null; Sync.refreshToken = null;
        }
      } catch (e) { console.warn('تعذر قراءة الإعدادات من الرابط', e); }
    }

    /* 2) هويتي */
    try {
      me.staffId = params.s || localStorage.getItem(LS + 'staff') || null;
      me.vehicleId = localStorage.getItem(LS + 'veh') || null;
    } catch (e) { }
    if (params.s) { try { localStorage.setItem(LS + 'staff', params.s); } catch (e) { } }

    /* نظّف الرابط عشان الإعدادات ما تفضلش ظاهرة */
    if (params.c || params.s) {
      try { history.replaceState(null, '', location.pathname); } catch (e) { }
    }

    S.pruneTracks(3);

    /* الفلوس مش شغل السواق ولا المسعف — نشيلها قبل ما تتخزن على الموبايل.
       (ده بيمنع وصولها للجهاز؛ الحماية الكاملة محتاجة حساب مستقل للمدير) */
    Sync.sanitize = function (col, rec) {
      if (col !== 'assignments') return rec;
      var clean = {};
      Object.keys(rec).forEach(function (k) {
        if (k === 'fee' || k.indexOf('pay') === 0) return;
        clean[k] = rec[k];
      });
      return clean;
    };

    document.getElementById('dSwitch').onclick = pickIdentity;

    Sync.onStatus(function (s) {
      var el = document.getElementById('dSub');
      if (!el) return;
      el.textContent = s === 'live' ? '◉ متصل' : s === 'connecting' ? 'جاري الاتصال...'
                     : s === 'error' ? '⚠ غير متصل — الحركات محفوظة وهتترفع لما النت يرجع'
                     : 'غير متصل بالمركز';
    });

    S.onChange(function () { if (ready) draw(); });

    /* من غير مزامنة الصفحة بتشتغل على بيانات نفس الجهاز فقط —
       مفيدة للتجربة، لكن المسعف في الشارع لازم يكون معاه رابط فيه الإعدادات */
    if (!Sync.config()) {
      standalone = true;
      document.getElementById('dSub').textContent = 'وضع تجربة محلي';
      ready = true;
      if (!S.all('staff').length) {
        body.innerHTML = '<div class="note bad"><strong>الرابط ناقص.</strong><br><br>' +
          'الصفحة دي محتاجة رابط الدعوة اللي بيبعتهولك المدير من النظام (جوّاه إعدادات الاتصال بالمركز).<br><br>' +
          'اطلب منه يبعتلك الرابط تاني على واتساب، وافتحه من هنا.</div>';
        return;
      }
      if (!me.staffId || !S.byId('staff', me.staffId)) pickIdentity();
      else draw();
      return;
    }

    document.getElementById('dSub').textContent = 'جاري الاتصال...';
    Sync.connect(['vehicles', 'staff', 'venues', 'assignments', 'attendance']).then(function (ok) {
      ready = true;
      if (!ok) AMB.toast('تعذر الاتصال بالمركز — هتشتغل أوفلاين والحركات هتترفع بعدين', 'warn', 7000);
      if (!me.staffId || !S.byId('staff', me.staffId)) pickIdentity();
      else draw();
    });

    /* اسحب الإعدادات دورياً كمان (حزام أمان لو البث اتقطع) */
    setInterval(function () {
      if (!Sync.config()) return;
      Sync.flush();
      Sync.pullOnce('assignments');
    }, 120000);

    setInterval(function () { if (ready) refreshHeader(); }, 15000);
  }

  /* ---------------- اختيار الهوية ---------------- */

  function pickIdentity() {
    var staff = S.all('staff').sort(byName);
    var vehicles = S.all('vehicles').sort(byName);

    if (!staff.length) { selfRegister(vehicles, true); return; }

    var body2 =
      '<div class="field"><label>مين حضرتك؟</label><select id="_s">' +
        staff.map(function (s) {
          return '<option value="' + esc(s._id) + '"' + (s._id === me.staffId ? ' selected' : '') + '>' +
                 esc(s.name) + (s.role ? ' — ' + esc(s.role) : '') + '</option>';
        }).join('') +
      '</select></div>' +
      '<div class="field"><label>على أنهي سيارة؟</label><select id="_v">' +
        '<option value="">— مش محدد —</option>' +
        vehicles.map(function (v) {
          return '<option value="' + esc(v._id) + '"' + (v._id === me.vehicleId ? ' selected' : '') + '>' + esc(v.name) + '</option>';
        }).join('') +
      '</select><div class="hint">السيارة دي هي اللي موقعها هيتبعت للمركز وأنت شغّال التتبع.</div></div>';

    UI.modal({
      title: 'تعريف نفسك', size: 'narrow', dismissable: !!me.staffId,
      body: body2,
      buttons: [
      { text: '＋ اسمي مش موجود', keepOpen: true, onClick: function (api) {
          api.close(); setTimeout(function () { selfRegister(vehicles, false); }, 150); return false;
        } },
      { text: 'تأكيد', cls: 'pri', keepOpen: true, onClick: function (api) {
        me.staffId = api.body.querySelector('#_s').value;
        me.vehicleId = api.body.querySelector('#_v').value || null;
        try {
          localStorage.setItem(LS + 'staff', me.staffId);
          if (me.vehicleId) localStorage.setItem(LS + 'veh', me.vehicleId);
          else localStorage.removeItem(LS + 'veh');
        } catch (e) { }
        api.close();
        draw();
        return true;
      } }]
    });
  }

  /* تسجيل ذاتي — السواق يسجّل نفسه من الرابط من غير ما يستنى المدير.
     ده بيشيل التعليق على جهاز واحد: أي حد يفتح الرابط يقدر يبدأ شغل فوراً،
     والاسم بيوصل لوحة المدير لحظياً عن طريق نفس المزامنة. */
  var DRV_ROLES = ['سائق', 'مسعف', 'مسعف أول', 'طبيب', 'فني'];

  function selfRegister(vehicles, first) {
    vehicles = vehicles || S.all('vehicles').sort(byName);

    var body =
      (first
        ? '<div class="note">أهلاً بيك 👋 دي أول مرة تفتح فيها الصفحة. اكتب بياناتك عشان تبدأ.</div>'
        : '<div class="note">اكتب بياناتك وهتتضاف للنظام على طول.</div>') +
      '<div class="field"><label>اسمك بالكامل <span style="color:var(--bad)">*</span></label>' +
        '<input type="text" id="_rn" placeholder="مثال: محمد أحمد" autocomplete="name"></div>' +
      '<div class="field"><label>وظيفتك</label><select id="_rr">' +
        DRV_ROLES.map(function (r) { return '<option value="' + esc(r) + '">' + esc(r) + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="field"><label>رقم موبايلك</label>' +
        '<input type="tel" id="_rp" inputmode="numeric" placeholder="01xxxxxxxxx" autocomplete="tel"></div>' +
      '<div class="field"><label>على أنهي سيارة؟</label><select id="_rv">' +
        '<option value="">— مش محدد دلوقتي —</option>' +
        vehicles.map(function (v) { return '<option value="' + esc(v._id) + '">' + esc(v.name) + '</option>'; }).join('') +
      '</select></div>' +
      '<div id="_rmsg"></div>';

    UI.modal({
      title: '📝 سجّل نفسك', size: 'narrow', dismissable: !first,
      body: body,
      buttons: [
        { text: 'تسجيل والبدء', cls: 'pri', keepOpen: true, onClick: function (api) {
            var name = api.body.querySelector('#_rn').value.trim();
            if (name.length < 2) {
              api.body.querySelector('#_rmsg').innerHTML = '<div class="note bad">اكتب اسمك الأول</div>';
              return false;
            }
            var role = api.body.querySelector('#_rr').value;
            var rec = {
              name: name,
              role: role,
              phone: api.body.querySelector('#_rp').value.trim(),
              countsAttendance: !M.NO_ATTENDANCE_ROLES[role],
              ratePerJob: 0,
              bonusPerJob: null,
              notes: 'سجّل نفسه من رابط الدعوة'
            };
            S.put('staff', rec);           // بيرفعه للسحابة تلقائياً
            me.staffId = rec._id;
            me.vehicleId = api.body.querySelector('#_rv').value || null;
            try {
              localStorage.setItem(LS + 'staff', me.staffId);
              if (me.vehicleId) localStorage.setItem(LS + 'veh', me.vehicleId);
              else localStorage.removeItem(LS + 'veh');
            } catch (e) { }
            api.close();
            AMB.toast('✓ أهلاً بيك يا ' + name, 'ok');
            draw();
            return true;
          } },
        { text: 'تحديث القايمة', keepOpen: true, onClick: function (api) {
            Sync.pullOnce('staff').then(function () {
              if ((S.all('staff') || []).length) { api.close(); setTimeout(pickIdentity, 200); }
              else api.body.querySelector('#_rmsg').innerHTML =
                '<div class="note warn">لسه مفيش حد مسجّل — كمّل تسجيل نفسك عادي.</div>';
            });
            return false;
          } }
      ]
    });
  }

  function byName(a, b) { return String(a.name || '').localeCompare(String(b.name || ''), 'ar'); }

  /* ---------------- الرسم ---------------- */

  function refreshHeader() {
    document.getElementById('dWho').textContent = me.staffId ? M.staffName(me.staffId) : '—';
    var t = document.getElementById('dTitle');
    var v = me.vehicleId ? S.byId('vehicles', me.vehicleId) : null;
    t.textContent = v ? v.name : 'تسجيل الحضور';
  }

  function draw() {
    refreshHeader();
    var h = '';

    if (standalone) {
      h += '<div class="note warn"><strong>وضع تجربة.</strong> الصفحة دي مش متصلة بالمركز، فاللي تسجله هيفضل على الجهاز ده بس. ' +
           'عشان تشتغل فعلياً، افتحها من رابط الدعوة اللي بيطلعه النظام بعد تفعيل المزامنة.</div>';
    }

    h += '<div class="seg">' +
      '<button data-tab="mission" class="' + (tab === 'mission' ? 'on' : '') + '">المهمة</button>' +
      '<button data-tab="fuel" class="' + (tab === 'fuel' ? 'on' : '') + '">⛽ تفويل</button>' +
      '<button data-tab="report" class="' + (tab === 'report' ? 'on' : '') + '">📝 ملاحظة / بلاغ</button>' +
      '</div>';

    if (tab === 'mission') h += missionHTML();
    else if (tab === 'fuel') h += fuelHTML();
    else h += reportHTML();

    body.innerHTML = h;

    body.querySelectorAll('[data-tab]').forEach(function (b) {
      b.onclick = function () { tab = b.dataset.tab; draw(); };
    });

    if (tab === 'mission') bindMission();
    else if (tab === 'fuel') bindFuel();
    else bindReport();
  }

  /* ---------------- تبويب المهمة ---------------- */

  function myJobsToday() {
    var t = AMB.today();
    return M.assignmentsOn(t).filter(function (a) {
      if (a.status === 'ملغاة') return false;
      var mine = (a.crew || []).indexOf(me.staffId) > -1;
      var myVeh = me.vehicleId && a.vehicleId === me.vehicleId;
      return mine || myVeh;
    });
  }

  var activeJobId = null;

  function currentJob() {
    var jobs = myJobsToday();
    if (!jobs.length) return null;
    if (activeJobId) {
      for (var i = 0; i < jobs.length; i++) if (jobs[i]._id === activeJobId) return jobs[i];
    }
    for (var j = 0; j < jobs.length; j++) if (jobs[j].status === 'جارية') return jobs[j];
    for (var k = 0; k < jobs.length; k++) if (jobs[k].status !== 'منتهية') return jobs[k];
    return jobs[jobs.length - 1];
  }

  function myChecks(jobId) {
    var out = {};
    S.all('attendance').forEach(function (r) {
      if (r.assignmentId === jobId && r.staffId === me.staffId) out[r.kind] = r;
    });
    return out;
  }

  function missionHTML() {
    var jobs = myJobsToday();
    var job = currentJob();

    var h = gpsBarHTML();

    if (!jobs.length) {
      h += '<div class="drv-card">' +
        UI.empty('▤', 'مفيش مهام مكلَّف بيها النهاردة',
                 'لو فيه مهمة والمفروض إنك عليها، كلّم المدير يضيفك للطاقم') +
        '<button class="btn block" id="dRefresh">🔄 تحديث</button></div>';
      return h;
    }

    if (jobs.length > 1) {
      h += '<div class="field"><label>مهام النهاردة (' + jobs.length + ')</label><select id="dJob">' +
        jobs.map(function (j) {
          return '<option value="' + esc(j._id) + '"' + (job && j._id === job._id ? ' selected' : '') + '>' +
            esc(AMB.fmtTime(j.time)) + ' — ' + esc(M.venueName(j.venueId)) + ' (' + esc(j.status || 'مجدولة') + ')</option>';
        }).join('') + '</select></div>';
    }

    var venue = M.venue(job.venueId);
    var done = myChecks(job._id);

    h += '<div class="drv-card drv-mission">' +
      '<div class="vt">' + esc(M.venueName(job.venueId)) + '</div>' +
      '<div class="mt">' + esc(AMB.fmtDay(job.date)) + '</div>' +
      '<div style="margin:12px 0 0">' +
        '<div class="kv"><span class="k">وقت المباراة</span><span class="v">' + esc(AMB.fmtTime(job.time)) + '</span></div>' +
        '<div class="kv"><span class="k">المفروض توصل قبل</span><span class="v">' + esc(arriveByText(job)) + '</span></div>' +
        '<div class="kv"><span class="k">السيارة</span><span class="v">' + esc(M.vehicleName(job.vehicleId)) + '</span></div>' +
        '<div class="kv"><span class="k">الطاقم</span><span class="v">' +
          ((job.crew || []).map(function (i) { return esc(M.staffName(i)); }).join('، ') || '—') + '</span></div>' +
      '</div>' +
      (job.notes ? '<div class="note" style="margin:12px 0 0">' + esc(job.notes) + '</div>' : '') +
      (venue && venue.lat != null
        ? '<button class="btn block" id="dNav" style="margin-top:12px">🗺 افتح الطريق في جوجل مابس</button>'
        : '<div class="note warn" style="margin:12px 0 0">⚠ الملعب ده مالوش موقع مسجّل — تسجيل الوصول مش هيتحقق من المكان. بلّغ المدير.</div>') +
    '</div>';

    /* أزرار الحركات */
    var nextKind = null;
    for (var i = 0; i < CHECKS.length; i++) { if (!done[CHECKS[i].k]) { nextKind = CHECKS[i].k; break; } }

    var counted = M.countsAttendance(me.staffId);
    h += '<h3 style="font-size:.95rem;margin:16px 0 6px">' + (counted ? 'تسجيل حضورك' : 'تسجيل حركة السيارة') + '</h3>';
    if (!counted) {
      h += '<p class="small muted" style="margin:0 0 10px">إنت مسجّل كسائق — الأزرار دي بتسجّل ' +
           '<strong>حركة السيارة</strong> عشان المدير يتابع الرحلة، ومش بتتحسب عليك حضور ولا تأخير.</p>';
    }

    h += '<div style="margin-top:4px">';
    CHECKS.forEach(function (c) {
      var rec = done[c.k];
      var isNext = c.k === nextKind;
      if (rec) {
        h += '<button class="big-btn grey" disabled>' +
          '<span>✓ ' + c.ic + ' ' + esc(c.t) + '</span>' +
          '<span class="s">تم الساعة ' + esc(AMB.fmtClock(rec.ts)) +
          (rec.valid === false ? ' — سُجّل خارج النطاق' : '') + '</span></button>';
      } else if (isNext) {
        h += '<button class="big-btn ' + c.cls + '" data-check="' + c.k + '">' +
          '<span>' + c.ic + ' ' + esc(c.t) + '</span><span class="s">' + esc(c.sub) + '</span></button>';
      } else {
        h += '<button class="big-btn grey" data-check="' + c.k + '" data-skip="1">' +
          '<span>' + c.ic + ' ' + esc(c.t) + '</span><span class="s">لسه بدري — اضغط لو محتاج تسجلها</span></button>';
      }
    });
    h += '</div>';

    if (!nextKind) {
      h += '<div class="note ok">✓ سجّلت كل حركات المهمة دي. ربنا يعينك.</div>';
    }

    /* التتبع */
    h += '<div class="drv-card">' +
      '<h3 style="font-size:.95rem;margin:0 0 8px">تتبع موقع السيارة</h3>' +
      '<p class="small muted" style="margin:0 0 10px">لما تشغّله، موقع السيارة بيوصل للمدير على طول. ' +
      'سيبه شغّال من الخروج لحد الرجوع، وخلي الشاشة مفتوحة أو الصفحة مفتوحة في الخلفية.</p>' +
      (me.vehicleId
        ? '<button class="btn block ' + (watchId != null ? 'danger' : 'ok') + '" id="dTrack">' +
          (watchId != null ? '⏹ إيقاف التتبع' : '▶ تشغيل التتبع') + '</button>'
        : '<div class="note warn" style="margin:0">اختار السيارة الأول من زرار «تغيير» فوق.</div>') +
    '</div>';

    return h;
  }

  function arriveByText(job) {
    var st = S.settings();
    var d = AMB.parseDay(job.date);
    var tp = (job.time || '00:00').split(':');
    d.setHours(+tp[0], +tp[1] || 0, 0, 0);
    var by = new Date(d.getTime() - (st.arriveBeforeMin || 30) * 60000);
    return AMB.fmtClock(by.getTime());
  }

  function gpsBarHTML() {
    var cls = gps.state === 'on' ? 'on' : gps.state === 'err' ? 'err' : '';
    var txt = gps.state === 'on'
      ? 'التتبع شغّال' + (gps.last ? ' — آخر إرسال ' + AMB.ago(gps.last.ts) + (gps.last.acc ? ' (دقة ±' + gps.last.acc + 'م)' : '') : '')
      : gps.state === 'err' ? (gps.err || 'مشكلة في تحديد الموقع')
      : 'التتبع متوقف';
    return '<div class="gps-bar ' + cls + '"><span class="dot"></span><span>' + esc(txt) + '</span></div>';
  }

  function bindMission() {
    var r = body.querySelector('#dRefresh');
    if (r) r.onclick = function () {
      this.disabled = true; this.textContent = 'جاري التحديث...';
      Promise.all([Sync.pullOnce('assignments'), Sync.pullOnce('venues'), Sync.pullOnce('staff')])
        .then(function () { draw(); AMB.toast('تم التحديث', 'ok'); });
    };

    var sel = body.querySelector('#dJob');
    if (sel) sel.onchange = function () { activeJobId = this.value; draw(); };

    var nav = body.querySelector('#dNav');
    if (nav) nav.onclick = function () {
      var job = currentJob(); var v = M.venue(job.venueId);
      if (v && v.lat != null) {
        window.open('https://www.google.com/maps/dir/?api=1&destination=' + v.lat + ',' + v.lng, '_blank', 'noopener');
      }
    };

    body.querySelectorAll('[data-check]').forEach(function (b) {
      b.onclick = function () { doCheck(b.dataset.check, b.dataset.skip === '1'); };
    });

    var tr = body.querySelector('#dTrack');
    if (tr) tr.onclick = function () { watchId != null ? stopTracking() : startTracking(); };
  }

  /* ---------------- تسجيل الحركة ---------------- */

  function doCheck(kind, isEarly) {
    var job = currentJob();
    if (!job) { AMB.toast('مفيش مهمة محددة', 'error'); return; }
    var c = checkDef(kind);
    var st = S.settings();
    var target = c.ref === 'garage' ? st.garage : M.venue(job.venueId);

    var btn = body.querySelector('[data-check="' + kind + '"]');
    var orig = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<span>⏳ جاري تحديد موقعك...</span><span class="s">خليك في مكان مكشوف</span>'; }

    Geo.once({ timeout: 25000 }).then(function (p) {
      var dist = (target && target.lat != null) ? AMB.distance(p.lat, p.lng, target.lat, target.lng) : null;
      var radius = target ? (target.radius || 200) : 200;
      var valid = dist == null ? null : dist <= radius;

      var proceed = function (force) {
        var rec = {
          assignmentId: job._id, staffId: me.staffId, kind: kind,
          ts: Date.now(), lat: p.lat, lng: p.lng, acc: p.acc,
          distance: dist, valid: valid, method: 'GPS',
          vehicleId: job.vehicleId || me.vehicleId || null,
          note: (isEarly ? 'سُجّل خارج الترتيب. ' : '') + (force ? 'أكّد التسجيل رغم البُعد عن المكان.' : '')
        };
        S.put('attendance', rec);

        /* حدّث حالة المهمة */
        var j = S.byId('assignments', job._id);
        if (j) {
          /* تحديث جزئي — الموبايل عنده نسخة من غير بيانات الفلوس،
             فلو رفع السجل كامل هيمسحها من السحابة */
          if (kind === 'depart_garage' && j.status === 'مجدولة') S.patch('assignments', j._id, { status: 'جارية' });
          if (kind === 'return_garage') S.patch('assignments', j._id, { status: 'منتهية' });
        }

        /* شغّل التتبع تلقائياً عند الخروج، وأوقفه عند العودة */
        if (kind === 'depart_garage' && me.vehicleId && watchId == null) startTracking(true);
        if (kind === 'return_garage' && watchId != null) stopTracking();

        AMB.toast('✓ تم تسجيل «' + c.t + '»' + (valid === false ? ' — لكنه خارج النطاق' : ''),
                  valid === false ? 'warn' : 'ok');
        draw();
      };

      if (valid === false) {
        UI.confirm('إنت على بُعد ' + AMB.fmtDistance(dist) + ' من ' + (c.ref === 'garage' ? 'الجراج' : M.venueName(job.venueId)) + '.', {
          title: '⚠ إنت بعيد عن المكان',
          detail: 'النطاق المسموح ' + radius + ' متر. لو سجّلت دلوقتي هيتعلّم في السجل إنه «خارج النطاق» والمدير هيشوفه.\n\n' +
                  'لو إنت فعلاً في المكان، استنى شوية في مكان مكشوف والـ GPS هيظبط.',
          yes: 'سجّل برضه', danger: true
        }).then(function (ok) {
          if (ok) proceed(true);
          else { if (btn) { btn.disabled = false; btn.innerHTML = orig; } }
        });
      } else if (valid === null) {
        UI.confirm('المكان ده مالوش موقع مسجّل، فمش هينفع نتحقق إنك فعلاً هناك.', {
          title: 'بدون تحقق موقع', yes: 'سجّل', detail: 'الحركة هتتسجل بالوقت والإحداثيات بتاعتك من غير مقارنة.'
        }).then(function (ok) {
          if (ok) proceed(false);
          else { if (btn) { btn.disabled = false; btn.innerHTML = orig; } }
        });
      } else {
        proceed(false);
      }

    }).catch(function (err) {
      if (btn) { btn.disabled = false; btn.innerHTML = orig; }
      AMB.toast(err.message, 'error', 8000);
    });
  }

  /* ---------------- التتبع ---------------- */

  function startTracking(silent) {
    if (!me.vehicleId) { AMB.toast('اختار السيارة الأول', 'warn'); return; }
    if (watchId != null) return;
    var st = S.settings();
    var interval = (st.pingSeconds || 20) * 1000;

    watchId = Geo.watch(function (p) {
      gps.state = 'on'; gps.err = null;
      if (Date.now() - lastPingTs < interval) { gps.last = p; updateGpsBar(); return; }
      lastPingTs = Date.now();
      gps.last = p;
      S.put('tracks', {
        vehicleId: me.vehicleId, staffId: me.staffId,
        lat: p.lat, lng: p.lng, acc: p.acc, speed: p.speed, heading: p.heading,
        ts: p.ts || Date.now()
      });
      updateGpsBar();
    }, function (err) {
      gps.state = 'err'; gps.err = err.message;
      updateGpsBar();
      AMB.toast(err.message, 'error', 7000);
    });

    if (watchId == null) return;
    requestWakeLock();
    if (!silent) AMB.toast('التتبع اشتغل — سيبه لحد ما ترجع الجراج', 'ok', 5000);
    gps.state = 'on';
    draw();
  }

  function stopTracking() {
    if (watchId == null) return;
    Geo.clear(watchId);
    watchId = null;
    gps.state = 'off';
    releaseWakeLock();
    AMB.toast('التتبع اتوقف');
    draw();
  }

  function updateGpsBar() {
    var bar = body.querySelector('.gps-bar');
    if (!bar) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = gpsBarHTML();
    bar.replaceWith(tmp.firstElementChild);
  }
  setInterval(function () { if (ready && tab === 'mission') updateGpsBar(); }, 20000);

  function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen').then(function (w) {
      wakeLock = w;
      w.addEventListener('release', function () { wakeLock = null; });
    }).catch(function () { });
  }
  function releaseWakeLock() { if (wakeLock) { try { wakeLock.release(); } catch (e) { } wakeLock = null; } }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      if (watchId != null && !wakeLock) requestWakeLock();
      Sync.flush();
    }
  });

  window.addEventListener('beforeunload', function (e) {
    if (watchId != null) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ---------------- تبويب التفويل ---------------- */

  function fuelHTML() {
    var vehicles = S.all('vehicles').sort(byName);
    var mine = S.all('fuel').filter(function (f) { return f.driverId === me.staffId; })
                .sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); }).slice(0, 6);

    var h = '<div class="drv-card"><h3 style="font-size:.98rem;margin:0 0 12px">تسجيل تفويل</h3>' +
      '<div class="field"><label>السيارة</label><select id="fV">' +
        vehicles.map(function (v) {
          return '<option value="' + esc(v._id) + '"' + (v._id === me.vehicleId ? ' selected' : '') + '>' + esc(v.name) + '</option>';
        }).join('') + '</select></div>' +
      '<div class="row">' +
        '<div class="field"><label>عدد اللترات</label><input type="number" id="fL" inputmode="decimal" step="0.1" min="0" placeholder="40"></div>' +
        '<div class="field"><label>الإجمالي (ج)</label><input type="number" id="fT" inputmode="decimal" step="0.01" min="0" placeholder="600"></div>' +
      '</div>' +
      '<div class="field"><label>قراءة العداد (كم)</label><input type="number" id="fO" inputmode="numeric" min="0" placeholder="' +
        (me.vehicleId ? (M.odometer(me.vehicleId) || '') : '') + '">' +
        '<div class="hint">مهمة جداً — منها المدير بيعرف استهلاك العربية.</div></div>' +
      '<div class="field"><label>المحطة</label><input type="text" id="fS" placeholder="موبيل — طريق النصر"></div>' +
      '<button class="btn pri block lg" id="fSave">حفظ التفويل</button></div>';

    if (mine.length) {
      h += '<div class="drv-card"><h3 style="font-size:.9rem;margin:0 0 8px">آخر تفويلاتك</h3>';
      mine.forEach(function (f) {
        h += '<div class="kv"><span class="k">' + esc(AMB.fmtDayShort(f.date)) + ' — ' + esc(M.vehicleName(f.vehicleId)) + '</span>' +
             '<span class="v">' + AMB.num(f.liters, 1) + ' لتر · ' + esc(AMB.money(f.total)) + '</span></div>';
      });
      h += '</div>';
    }
    return h;
  }

  function bindFuel() {
    var L = body.querySelector('#fL'), T = body.querySelector('#fT');
    body.querySelector('#fSave').onclick = function () {
      var liters = Number(L.value) || 0;
      var total = Number(T.value) || 0;
      var odo = Number(body.querySelector('#fO').value) || 0;
      if (!liters) { AMB.toast('اكتب عدد اللترات', 'error'); return; }
      var vid = body.querySelector('#fV').value;
      S.put('fuel', {
        vehicleId: vid, date: AMB.today(), liters: liters, total: total,
        price: liters && total ? Number((total / liters).toFixed(2)) : 0,
        odometer: odo, station: body.querySelector('#fS').value.trim(),
        driverId: me.staffId, notes: 'سُجّل من موبايل السائق'
      });
      var v = S.byId('vehicles', vid);
      if (v && odo > (Number(v.odometer) || 0)) S.patch('vehicles', v._id, { odometer: odo });
      AMB.toast('✓ تم تسجيل التفويل', 'ok');
      draw();
    };
  }

  /* ---------------- تبويب البلاغات ---------------- */

  var ISSUE_TYPES = ['عطل ميكانيكي', 'كهرباء', 'إطار', 'فرامل', 'تكييف / تبريد',
                     'أجهزة طبية عاطلة', 'حادث', 'أخرى'];

  var NOTE_TYPES = ['نقص أدوات', 'نقص مستلزمات طبية', 'نقص أدوية', 'نظافة السيارة',
                    'حاجة محتاجة متابعة', 'ملاحظة عامة'];

  var reportMode = 'note';   // note | fault

  function reportHTML() {
    var vehicles = S.all('vehicles').sort(byName);
    var mine = S.all('incidents').filter(function (r) { return r.staffId === me.staffId; })
                .sort(function (a, b) { return b.ts - a.ts; }).slice(0, 6);
    var fault = reportMode === 'fault';

    var h = '<div class="seg" style="margin-bottom:12px">' +
      '<button data-rm="note" class="' + (fault ? '' : 'on') + '">📝 ملاحظة</button>' +
      '<button data-rm="fault" class="' + (fault ? 'on' : '') + '">⚠ بلاغ عطل</button>' +
      '</div>';

    h += '<div class="drv-card">' +
      '<h3 style="font-size:.98rem;margin:0 0 4px">' + (fault ? 'بلاغ عطل' : 'ملاحظة على السيارة') + '</h3>' +
      '<p class="small muted" style="margin:0 0 12px">' +
        (fault ? 'العطل بيوصل المدير على طول ويظهر في شاشة الصيانة.'
               : 'أي حاجة لاحظتها في العربية — ناقصة أدوات، محتاجة نضافة، أي حاجة محتاجة متابعة.') +
      '</p>' +
      '<div class="field"><label>السيارة</label><select id="iV">' +
        vehicles.map(function (v) {
          return '<option value="' + esc(v._id) + '"' + (v._id === me.vehicleId ? ' selected' : '') + '>' + esc(v.name) + '</option>';
        }).join('') + '</select></div>' +
      '<div class="field"><label>' + (fault ? 'نوع العطل' : 'نوع الملاحظة') + '</label><select id="iT">' +
        (fault ? ISSUE_TYPES : NOTE_TYPES).map(function (t) { return '<option>' + esc(t) + '</option>'; }).join('') +
      '</select></div>' +
      (fault
        ? '<div class="field"><label>درجة الخطورة</label><select id="iS">' +
            '<option value="عادي">عادي — العربية شغالة</option>' +
            '<option value="مهم">مهم — محتاج صيانة قريب</option>' +
            '<option value="عاجل">عاجل — العربية متوقفة</option>' +
          '</select></div>'
        : '') +
      '<div class="field"><label>' + (fault ? 'الوصف' : 'اكتب الملاحظة') + '</label>' +
        '<textarea id="iD" rows="3" placeholder="' +
        (fault ? 'اكتب المشكلة بالتفصيل...' : 'مثلاً: ناقص شنطة إسعافات أولية / العربية محتاجة غسيل') +
        '"></textarea></div>' +
      '<label class="chk" style="margin-bottom:12px"><input type="checkbox" id="iLoc"' + (fault ? ' checked' : '') + '> أرفق موقعي الحالي</label>' +
      '<button class="btn pri block lg" id="iSave">' + (fault ? 'إرسال البلاغ' : 'حفظ الملاحظة') + '</button></div>';

    if (mine.length) {
      h += '<div class="drv-card"><h3 style="font-size:.9rem;margin:0 0 8px">آخر اللي سجّلته</h3>';
      mine.forEach(function (r) {
        var note = r.kind === 'ملاحظة';
        h += '<div class="kv"><span class="k">' + (note ? '📝 ' : '⚠ ') + esc(r.type) +
          '<br><span class="small muted">' + esc(AMB.fmtStamp(r.ts)) + '</span></span>' +
          '<span class="v"><span class="tag ' + (r.severity === 'عاجل' ? 'bad' : r.severity === 'مهم' ? 'warn' : note ? 'info' : '') + '">' +
          esc(note ? 'ملاحظة' : r.severity) + '</span><br><span class="small muted">' + esc(r.status || 'جديد') + '</span></span></div>';
      });
      h += '</div>';
    }
    return h;
  }

  function bindReport() {
    body.querySelectorAll('[data-rm]').forEach(function (b) {
      b.onclick = function () { reportMode = b.dataset.rm; draw(); };
    });

    body.querySelector('#iSave').onclick = function () {
      var fault = reportMode === 'fault';
      var desc = body.querySelector('#iD').value.trim();
      if (!desc) { AMB.toast(fault ? 'اكتب وصف المشكلة' : 'اكتب الملاحظة', 'error'); return; }
      var b = this; b.disabled = true; b.textContent = 'جاري الحفظ...';

      var sev = body.querySelector('#iS');
      var rec = {
        kind: fault ? 'بلاغ' : 'ملاحظة',
        vehicleId: body.querySelector('#iV').value,
        type: body.querySelector('#iT').value,
        severity: fault ? sev.value : 'ملاحظة',
        description: desc, staffId: me.staffId, ts: Date.now(),
        status: 'جديد', lat: null, lng: null
      };

      var finish = function () {
        S.put('incidents', rec);
        if (fault && rec.severity === 'عاجل') {
          var v = S.byId('vehicles', rec.vehicleId);
          if (v && v.status !== 'صيانة') S.patch('vehicles', v._id, { status: 'صيانة' });
        }
        AMB.toast(fault ? '✓ تم إرسال البلاغ للمدير' : '✓ تم حفظ الملاحظة', 'ok', 5000);
        b.disabled = false; b.textContent = fault ? 'إرسال البلاغ' : 'حفظ الملاحظة';
        draw();
      };

      if (body.querySelector('#iLoc').checked) {
        Geo.once({ timeout: 12000 }).then(function (p) {
          rec.lat = p.lat; rec.lng = p.lng; finish();
        }).catch(function () { finish(); });
      } else finish();
    };
  }

  /* ---------------- انطلق ---------------- */

  document.addEventListener('DOMContentLoaded', boot);

})();
