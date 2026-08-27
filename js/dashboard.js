/* ============================================================
   لوحة المدير — كل الشاشات
   ============================================================ */
(function () {
  'use strict';

  var S = AMB.Store, M = AMB.Model, Sync = AMB.Sync;
  var esc = AMB.esc, money = AMB.money, num = AMB.num;

  var CHECKS = [
    { k: 'depart_garage', t: 'خروج من الجراج', ic: '🚪', ref: 'garage', color: '#7b61ff' },
    { k: 'arrive_venue',  t: 'الوصول للملعب',  ic: '📍', ref: 'venue',  color: '#17864a' },
    { k: 'leave_venue',   t: 'مغادرة الملعب',  ic: '↩',  ref: 'venue',  color: '#a86300' },
    { k: 'return_garage', t: 'العودة للجراج',  ic: '🏁', ref: 'garage', color: '#566275' }
  ];
  function checkDef(k) { for (var i = 0; i < CHECKS.length; i++) if (CHECKS[i].k === k) return CHECKS[i]; return null; }

  var JOB_STATUS = ['مجدولة', 'جارية', 'منتهية', 'ملغاة'];

  /* حالات تحصيل فلوس المباراة */
  var PAY = {
    NONE: 'لم يُحصّل',
    DRIVER: 'مع السواق',
    IN: 'محصّل',
    LATER: 'مؤجل'
  };
  var PAY_STATUS = [PAY.NONE, PAY.DRIVER, PAY.IN, PAY.LATER];
  var PAY_METHODS = ['كاش', 'تحويل بنكي', 'انستاباي / محفظة', 'شيك'];
  var VEH_STATUS = ['متاح', 'في مهمة', 'صيانة', 'متوقف'];
  var ROLES = ['سائق', 'مسعف', 'مسعف أول', 'طبيب', 'فني'];
  var MAINT_TYPES = ['غسيل وتنظيف', 'زيت وفلاتر', 'صيانة دورية', 'إطارات', 'فرامل', 'كهرباء',
                     'تبريد وتكييف', 'تعقيم وتطهير', 'أجهزة طبية', 'عطل طارئ', 'رخصة / فحص', 'أخرى'];

  /* مواعيد التكرار المقترحة لكل نوع — بتتحط تلقائياً وتقدر تعدّلها */
  var MAINT_EVERY = {
    'غسيل وتنظيف':  { days: 14,  label: 'كل أسبوعين' },
    'زيت وفلاتر':   { km: 5000,  label: 'كل 5000 كم' },
    'صيانة دورية':  { km: 10000, label: 'كل 10000 كم' },
    'إطارات':       { km: 40000, label: 'كل 40000 كم' },
    'فرامل':        { km: 20000, label: 'كل 20000 كم' },
    'تعقيم وتطهير': { days: 7,   label: 'كل أسبوع' },
    'أجهزة طبية':   { days: 90,  label: 'كل 3 شهور' },
    'رخصة / فحص':   { days: 365, label: 'كل سنة' }
  };
  var FUEL_TYPES = ['سولار', 'بنزين 80', 'بنزين 92', 'بنزين 95', 'غاز طبيعي'];

  /* أنواع الملاحظات — مش أعطال، مجرد حاجات لاحظها السواق أو المسعف */
  var NOTE_TYPES = ['نقص أدوات', 'نقص مستلزمات طبية', 'نقص أدوية', 'نظافة السيارة',
                    'حاجة محتاجة متابعة', 'ملاحظة عامة'];

  function isNote(r) { return r.kind === 'ملاحظة'; }
  function isFault(r) { return r.kind !== 'ملاحظة'; }
  var PALETTE = ['#e63946', '#1d75d8', '#2a9d5c', '#a8620d', '#7b61ff', '#0e9594', '#d1478a'];

  var current = 'dash';
  var liveMap = null, liveTimer = null;

  /* ============================================================
     قفل البيانات المالية — تظهر للمالك بس
     ============================================================ */

  var Owner = {
    _h: function (s) {
      var h = 5381;
      for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
      return h.toString(36);
    },
    hasPin: function () { return !!S.settings().ownerPin; },
    unlocked: function () {
      try { return sessionStorage.getItem('amb_owner') === '1'; } catch (e) { return false; }
    },
    locked: function () { return this.hasPin() && !this.unlocked(); },
    setPin: function (p) {
      var st = S.settings();
      st.ownerPin = p ? this._h(String(p)) : '';
      S.saveSettings(st);
    },
    check: function (p) { return S.settings().ownerPin === this._h(String(p)); },
    lock: function () {
      try { sessionStorage.removeItem('amb_owner'); } catch (e) { }
      render();
      AMB.toast('تم قفل البيانات المالية', 'ok');
    },
    unlock: function () {
      var self = this;
      return new Promise(function (resolve) {
        if (!self.locked()) { resolve(true); return; }
        var done = false;
        var m = UI.modal({
          title: '🔒 البيانات المالية مقفولة', size: 'narrow',
          body: '<p class="small muted">اكتب الرقم السري بتاعك عشان تشوف الفلوس والتقارير المالية.</p>' +
                '<div class="field"><input type="password" id="_pin" inputmode="numeric" ' +
                'style="font-size:1.3rem;text-align:center;letter-spacing:6px" placeholder="••••"></div>' +
                '<div id="_pinerr"></div>',
          buttons: [
            { text: 'فتح', cls: 'pri', keepOpen: true, onClick: function (api) {
                var v = api.body.querySelector('#_pin').value;
                if (self.check(v)) {
                  try { sessionStorage.setItem('amb_owner', '1'); } catch (e) { }
                  done = true; api.close(); resolve(true);
                } else {
                  api.body.querySelector('#_pinerr').innerHTML = '<div class="note bad">الرقم غلط</div>';
                  api.body.querySelector('#_pin').value = '';
                  api.body.querySelector('#_pin').focus();
                }
                return false;
              } },
            { spacer: true }, { text: 'إلغاء' }
          ],
          onClose: function () { if (!done) resolve(false); }
        });
        m.body.querySelector('#_pin').addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); m.foot.querySelector('.btn').click(); }
        });
      });
    }
  };

  /* مبلغ مالي — بيتخفي لو القفل شغّال */
  function fmoney(n) { return Owner.locked() ? '••••' : money(n); }
  function fnum(n, d) { return Owner.locked() ? '••••' : num(n, d); }

  var LOCKED_VIEWS = { pay: 1, reports: 1, payroll: 1 };

  /* ---------------- التوجيه ---------------- */

  var VIEWS = {
    dash:     { title: 'لوحة التحكم',        render: viewDash },
    schedule: { title: 'جدول المباريات',     render: viewSchedule },
    live:     { title: 'الخريطة الحية',       render: viewLive },
    attend:   { title: 'الحضور والانصراف',   render: viewAttend },
    pay:      { title: 'التحصيل والفلوس',     render: viewPay },
    payroll:  { title: 'مستحقات الفريق',      render: viewPayroll },
    fleet:    { title: 'السيارات',            render: viewFleet },
    maint:    { title: 'الصيانة',             render: viewMaint },
    fuel:     { title: 'التفويل',             render: viewFuel },
    staff:    { title: 'المسعفين والسواقين',  render: viewStaff },
    venues:   { title: 'الملاعب والأندية',    render: viewVenues },
    reports:  { title: 'التقارير',            render: viewReports },
    settings: { title: 'الإعدادات',           render: viewSettings }
  };

  function go(v) {
    if (!VIEWS[v]) v = 'dash';
    /* الشاشات المالية محتاجة فتح القفل */
    if (LOCKED_VIEWS[v] && Owner.locked()) {
      Owner.unlock().then(function (ok) { if (ok) go(v); });
      return;
    }
    if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
    if (liveMap && v !== 'live') { liveMap.destroy(); liveMap = null; }
    current = v;
    document.querySelectorAll('#nav button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.v === v);
    });
    document.getElementById('viewTitle').textContent = VIEWS[v].title;
    document.getElementById('viewSub').textContent = '';
    try { history.replaceState(null, '', '#' + v); } catch (e) { }
    render();
  }

  var renderPending = false;
  function render() {
    if (renderPending) return;
    renderPending = true;
    /* setTimeout مش requestAnimationFrame — عشان التحديثات تشتغل
       حتى والتبويب في الخلفية (rAF بتتجمد وقتها) */
    setTimeout(function () {
      renderPending = false;
      var host = document.getElementById('view');
      host.scrollTop = 0;
      try { VIEWS[current].render(host); } catch (e) {
        console.error(e);
        host.innerHTML = '<div class="note bad">حصل خطأ في عرض الشاشة: ' + esc(e.message) + '</div>';
      }
      updateBadges();
    }, 16);
  }

  function updateBadges() {
    var due = M.dueMaintenance().length +
              S.all('incidents').filter(function (r) { return r.status !== 'تم الحل'; }).length;
    var b1 = document.getElementById('badgeMaint');
    b1.textContent = due; b1.classList.toggle('hidden', !due);

    var noLoc = S.all('venues').filter(function (v) { return v.lat == null; }).length;
    var b2 = document.getElementById('badgeVenues');
    b2.textContent = noLoc; b2.classList.toggle('hidden', !noLoc);

    /* مباريات فاتت ولسه فلوسها ما اتحصّلتش */
    var unpaid = billable(S.all('assignments')).filter(isDue).length;
    /* أفراد لسه ما اتحاسبوش عن الأسبوع اللي فات */
    var stx = S.settings();
    var lastW = M.shiftWeek(M.weekRange(AMB.today(), stx.weekStart), -1, stx.weekStart);
    var owing = S.all('staff').filter(function (s) {
      if (M.payoutFor(s._id, lastW.from, lastW.to)) return false;
      var n = M.jobsOfStaff(s._id, lastW.from, lastW.to).length;
      return n > 0 && (M.rateOf(s._id) > 0 || M.bonusRateOf(s._id) > 0);
    }).length;
    var b4 = document.getElementById('badgeRoll');
    if (b4) { b4.textContent = owing; b4.classList.toggle('hidden', !owing || Owner.locked()); }

    var b3 = document.getElementById('badgePay');
    if (b3) {
      /* لو القفل شغّال، حتى عدد المباريات المستحقة مايبانش */
      var show = unpaid && !Owner.locked();
      b3.textContent = unpaid; b3.classList.toggle('hidden', !show);
    }

    /* زرار القفل + علامة على الشاشات المقفولة */
    var lk = document.getElementById('btnLock');
    if (lk) {
      lk.classList.toggle('hidden', !Owner.hasPin());
      var isLocked = Owner.locked();
      lk.textContent = isLocked ? '🔒' : '🔓';
      lk.title = isLocked ? 'البيانات المالية مقفولة — اضغط للفتح' : 'اقفل البيانات المالية';
    }
    var BASE_IC = { pay: '₤', reports: '▥', payroll: '☰' };
    document.querySelectorAll('#nav button').forEach(function (b) {
      var v = b.dataset.v;
      if (!BASE_IC[v]) return;
      b.querySelector('.ic').textContent = (LOCKED_VIEWS[v] && Owner.locked()) ? '🔒' : BASE_IC[v];
    });
  }

  /* ============================================================
     1) لوحة التحكم
     ============================================================ */

  function viewDash(host) {
    var t = AMB.today();
    var jobs = M.assignmentsOn(t);
    var vehicles = S.all('vehicles');
    var due = M.dueMaintenance();
    var st = S.settings();

    var mStart = t.slice(0, 8) + '01';
    var mEnd = t.slice(0, 8) + '31';
    var fin = M.finance(mStart, mEnd);

    var active = jobs.filter(function (j) { return j.status === 'جارية'; }).length;
    var doneToday = jobs.filter(function (j) { return j.status === 'منتهية'; }).length;

    var h = '';

    /* تنبيهات */
    var alerts = [];
    if (!st.garage || st.garage.lat == null) {
      alerts.push({ k: 'warn', t: 'موقع الجراج غير محدد — من غيره مش هينفع نحسب وقت الخروج والعودة.',
                    b: '<button class="btn sm" data-go="settings">حدد الجراج</button>' });
    }
    var noLoc = S.all('venues').filter(function (v) { return v.lat == null; });
    if (noLoc.length) {
      alerts.push({ k: 'warn', t: noLoc.length + ' ملعب لسه من غير موقع على الخريطة — تسجيل الحضور مش هيشتغل ليها.',
                    b: '<button class="btn sm" data-go="venues">حدد المواقع</button>' });
    }
    /* فلوس مستحقة على مباريات فاتت */
    var pastDue = billable(S.all('assignments')).filter(isDue);
    if (pastDue.length) {
      var owed = pastDue.reduce(function (a, j) { return a + dueAmount(j); }, 0);
      alerts.push({ k: 'warn',
        t: pastDue.length + ' مباراة فاتت وفلوسها لسه ما اتحصّلتش — بإجمالي ' + fmoney(owed) + '.',
        b: '<button class="btn sm" data-go="pay">شوف التحصيل</button>' });
    }
    var withDrivers = billable(S.all('assignments')).filter(function (j) { return payStatusOf(j) === PAY.DRIVER; });
    if (withDrivers.length) {
      alerts.push({ k: '',
        t: fmoney(withDrivers.reduce(function (a, j) { return a + paidAmount(j); }, 0)) +
           ' محصّلة كاش ولسه مع الفريق (' + withDrivers.length + ' مباراة).',
        b: '<button class="btn sm" data-go="pay">تفاصيل</button>' });
    }

    /* مستحقات الأسبوع اللي فات */
    var lastWeek = M.shiftWeek(M.weekRange(t, st.weekStart), -1, st.weekStart);
    var owed = [];
    S.all('staff').forEach(function (s) {
      if (M.payoutFor(s._id, lastWeek.from, lastWeek.to)) return;
      var sw = M.staffWeek(s._id, lastWeek.from, lastWeek.to);
      if (sw.jobs > 0 && (sw.earned + sw.autoBonus) > 0) owed.push(sw);
    });
    if (owed.length) {
      alerts.push({ k: 'warn',
        t: owed.length + ' من الفريق لسه ما اتحاسبوش عن الأسبوع اللي فات — بإجمالي ' +
           money(owed.reduce(function (a, x) { return a + x.earned + x.autoBonus; }, 0)) + '.',
        b: '<button class="btn sm" data-go="payroll">شوف المستحقات</button>' });
    }

    var urgent = S.all('incidents').filter(function (r) { return r.status !== 'تم الحل'; });
    if (urgent.length) {
      var crit = urgent.filter(function (r) { return r.severity === 'عاجل'; }).length;
      alerts.push({ k: crit ? 'bad' : 'warn',
                    t: urgent.length + ' بلاغ مفتوح من السواقين' + (crit ? ' — منها ' + crit + ' عاجل (عربية متوقفة)!' : '.'),
                    b: '<button class="btn sm" data-go="maint">عرض البلاغات</button>' });
    }
    if (due.length) {
      var over = due.filter(function (d) { return d.overdue; }).length;
      alerts.push({ k: over ? 'bad' : 'warn',
                    t: due.length + ' صيانة مستحقة' + (over ? ' — منها ' + over + ' متأخرة!' : ' قريباً.'),
                    b: '<button class="btn sm" data-go="maint">عرض</button>' });
    }
    if (!Sync.config()) {
      alerts.push({ k: '', t: 'المزامنة اللحظية متوقفة — النظام شغال على الجهاز ده بس، والخريطة الحية مش هتوصلها بيانات.',
                    b: '<button class="btn sm" data-go="settings">تفعيل الآن</button>' });
    }
    alerts.forEach(function (a) {
      h += '<div class="note ' + a.k + '" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
           '<span style="flex:1">' + esc(a.t) + '</span>' + (a.b || '') + '</div>';
    });

    /* الأرقام */
    h += '<div class="grid g4" style="margin-bottom:16px">' +
      stat('مهام اليوم', jobs.length, (active ? active + ' جارية الآن' : (doneToday ? doneToday + ' انتهت' : 'لا يوجد نشاط')), active ? '#17864a' : '#1d75d8') +
      stat('السيارات المتاحة', vehicles.filter(function (v) { return v.status === 'متاح'; }).length + ' / ' + vehicles.length,
           vehicles.filter(function (v) { return v.status === 'صيانة'; }).length + ' في الصيانة', '#c1121f') +
      stat('إيراد الشهر', fmoney(fin.revenue), fin.jobs + ' مهمة', '#17864a') +
      stat('صافي الشهر', fmoney(fin.net), 'مصروفات ' + fmoney(fin.expenses), fin.net >= 0 ? '#17864a' : '#c1121f') +
      '</div>';

    h += '<div class="grid g2">';

    /* مهام اليوم */
    h += '<div class="card"><div class="card-h"><h3>مهام اليوم — ' + esc(AMB.fmtDay(t)) + '</h3>' +
         '<span class="spacer"></span><button class="btn sm pri" id="dashAdd">+ مهمة</button></div>';
    if (!jobs.length) {
      h += '<div class="card-b tight">' + UI.empty('▤', 'مفيش مباريات النهاردة', 'اضغط «+ مهمة» لإضافة تأمين مباراة') + '</div>';
    } else {
      h += '<ul class="list">';
      jobs.forEach(function (j) {
        var v = S.byId('vehicles', j.vehicleId);
        h += '<li data-job="' + j._id + '" style="cursor:pointer">' +
          '<div style="min-width:56px"><div class="ttl mono">' + esc(AMB.fmtTime(j.time)) + '</div></div>' +
          '<div style="flex:1;min-width:0">' +
            '<div class="ttl">' + esc(M.venueName(j.venueId)) + '</div>' +
            '<div class="sub">' + (v ? '<span class="swatch" style="background:' + esc(v.color || '#888') + '"></span>' + esc(v.name) : '<span style="color:var(--bad)">لم تُسند سيارة</span>') +
            ((j.crew || []).length ? ' · ' + j.crew.length + ' أفراد' : ' · <span style="color:var(--bad)">بدون طاقم</span>') + '</div>' +
          '</div>' +
          statusTag(j.status) +
        '</li>';
      });
      h += '</ul>';
    }
    h += '</div>';

    /* حالة الأسطول */
    h += '<div class="card"><div class="card-h"><h3>حالة الأسطول الآن</h3><span class="spacer"></span>' +
         '<button class="btn sm" data-go="live">الخريطة الحية ←</button></div>';
    if (!vehicles.length) {
      h += '<div class="card-b tight">' + UI.empty('▣', 'مفيش سيارات', '', '<button class="btn pri sm" data-go="fleet">أضف سيارة</button>') + '</div></div>';
    } else {
    h += '<ul class="list">';
    vehicles.forEach(function (v) {
      var p = M.lastPing(v._id);
      var job = M.currentAssignment(v._id);
      var fresh = p && (Date.now() - p.ts) < 300000;
      h += '<li>' +
        '<span class="swatch" style="width:14px;height:14px;background:' + esc(v.color || '#888') + '"></span>' +
        '<div style="flex:1;min-width:0">' +
          '<div class="ttl">' + esc(v.name) + (v.plate ? ' <span class="muted small mono">' + esc(v.plate) + '</span>' : '') + '</div>' +
          '<div class="sub">' + (job ? esc(M.venueName(job.venueId)) + ' — ' + esc(AMB.fmtTime(job.time)) : 'لا توجد مهمة اليوم') + '</div>' +
        '</div>' +
        '<div style="text-align:end">' +
          vehTag(v.status) +
          '<div class="sub" style="margin-top:2px">' + (p ? (fresh ? '<span style="color:var(--ok)">◉ ' + esc(AMB.ago(p.ts)) + '</span>' : esc(AMB.ago(p.ts))) : 'لا إشارة') + '</div>' +
        '</div>' +
      '</li>';
    });
    h += '</ul></div>';
    }

    h += '</div>'; /* grid */

    /* الصيانة المستحقة */
    if (due.length) {
      h += '<div class="card"><div class="card-h"><h3>صيانة مستحقة</h3><span class="spacer"></span>' +
           '<button class="btn sm" data-go="maint">إدارة الصيانة ←</button></div><ul class="list">';
      due.slice(0, 6).forEach(function (d) {
        h += '<li><span class="tag ' + (d.overdue ? 'bad' : 'warn') + ' dot">' + esc(d.reason) + '</span>' +
             '<div style="flex:1"><div class="ttl">' + esc(M.vehicleName(d.vehicleId)) + '</div>' +
             '<div class="sub">' + esc(d.record.type || 'صيانة') + (d.record.workshop ? ' · ' + esc(d.record.workshop) : '') + '</div></div></li>';
      });
      h += '</ul></div>';
    }

    /* آخر الحركات */
    var recent = S.all('attendance').sort(function (a, b) { return b.ts - a.ts; }).slice(0, 10);
    if (recent.length) {
      h += '<div class="card"><div class="card-h"><h3>آخر حركات مسجلة</h3><span class="spacer"></span>' +
           '<button class="btn sm" data-go="attend">كل السجل ←</button></div><div class="card-b"><div class="tl">';
      recent.forEach(function (r) {
        var d = checkDef(r.kind);
        var a = S.byId('assignments', r.assignmentId);
        h += '<div class="tl-item" style="--c:' + (d ? d.color : '#888') + '">' +
          '<div class="t">' + esc(AMB.fmtStamp(r.ts)) + '</div>' +
          '<div class="m">' + (d ? d.ic + ' ' + esc(d.t) : esc(r.kind)) + ' — ' + esc(M.staffName(r.staffId)) + '</div>' +
          '<div class="d">' + (a ? esc(M.venueName(a.venueId)) + ' · ' + esc(M.vehicleName(a.vehicleId)) : '—') +
          (r.distance != null ? ' · على بُعد ' + esc(AMB.fmtDistance(r.distance)) : '') +
          (r.valid === false ? ' <span class="tag bad">خارج النطاق</span>' : '') + '</div>' +
        '</div>';
      });
      h += '</div></div></div>';
    }

    host.innerHTML = h;

    host.querySelectorAll('[data-go]').forEach(function (b) { b.onclick = function () { go(b.dataset.go); }; });
    var add = host.querySelector('#dashAdd');
    if (add) add.onclick = function () { editAssignment(null, t); };
    host.querySelectorAll('[data-job]').forEach(function (li) {
      li.onclick = function () { jobDetail(li.dataset.job); };
    });
  }

  function stat(k, v, n, c) {
    return '<div class="stat" style="--c:' + c + '"><div class="k">' + esc(k) + '</div>' +
           '<div class="v">' + esc(String(v)) + '</div><div class="n">' + esc(n || '') + '</div></div>';
  }

  function statusTag(s) {
    var cls = s === 'جارية' ? 'ok' : s === 'ملغاة' ? 'bad' : s === 'منتهية' ? '' : 'info';
    return '<span class="tag ' + cls + '">' + esc(s || 'مجدولة') + '</span>';
  }
  function vehTag(s) {
    var cls = s === 'متاح' ? 'ok' : s === 'صيانة' ? 'warn' : s === 'متوقف' ? 'bad' : 'info';
    return '<span class="tag ' + cls + '">' + esc(s || 'متاح') + '</span>';
  }

  /* ============================================================
     2) جدول المباريات
     ============================================================ */

  var calMonth = new Date();
  var schedMode = 'cal';

  function viewSchedule(host) {
    var y = calMonth.getFullYear(), mo = calMonth.getMonth();

    var h = '<div class="filters no-print">' +
      '<button class="btn sm" id="prevM">‹ السابق</button>' +
      '<strong style="min-width:130px;text-align:center">' + AMB.AR_MONTHS[mo] + ' ' + y + '</strong>' +
      '<button class="btn sm" id="nextM">التالي ›</button>' +
      '<button class="btn sm" id="thisM">الشهر الحالي</button>' +
      '<span class="spacer"></span>' +
      '<div class="seg" style="margin:0;width:auto">' +
        '<button id="mCal" class="' + (schedMode === 'cal' ? 'on' : '') + '">تقويم</button>' +
        '<button id="mList" class="' + (schedMode === 'list' ? 'on' : '') + '">قائمة</button>' +
      '</div>' +
      '<button class="btn sm" id="impSched">⤒ استيراد جدول</button>' +
      '<button class="btn sm" id="expSched">⤓ تصدير</button>' +
      '<button class="btn pri sm" id="addJob">+ مهمة جديدة</button>' +
      '</div>';

    h += '<div class="print-head"><h2>جدول التأمين — ' + AMB.AR_MONTHS[mo] + ' ' + y + '</h2></div>';

    if (schedMode === 'cal') h += calendarHTML(y, mo);
    else h += listHTML(y, mo);

    host.innerHTML = h;

    host.querySelector('#prevM').onclick = function () { calMonth = new Date(y, mo - 1, 1); render(); };
    host.querySelector('#nextM').onclick = function () { calMonth = new Date(y, mo + 1, 1); render(); };
    host.querySelector('#thisM').onclick = function () { calMonth = new Date(); render(); };
    host.querySelector('#mCal').onclick = function () { schedMode = 'cal'; render(); };
    host.querySelector('#mList').onclick = function () { schedMode = 'list'; render(); };
    host.querySelector('#addJob').onclick = function () { editAssignment(null, AMB.today()); };
    host.querySelector('#expSched').onclick = function () { exportSchedule(y, mo); };
    host.querySelector('#impSched').onclick = importSchedule;

    host.querySelectorAll('[data-day]').forEach(function (d) {
      d.onclick = function (e) {
        if (e.target.closest('[data-job]')) return;
        daySheet(d.dataset.day);
      };
    });
    host.querySelectorAll('[data-job]').forEach(function (el) {
      el.onclick = function (e) { e.stopPropagation(); jobDetail(el.dataset.job); };
    });
    host.querySelectorAll('[data-jdel]').forEach(function (el) {
      el.onclick = function (e) { e.stopPropagation(); deleteAssignment(el.dataset.jdel); };
    });
  }

  /* ---------- شاشة اليوم ----------
     الضغط على يوم بيفتح كل مهامه — تختار منها اللي عايزه وتعدّله،
     بدل ما كان بيفتح «مهمة جديدة» على طول والمهام الزيادة مخفية. */
  function daySheet(iso) {
    var jobs = M.assignmentsOn(iso).slice().sort(function (a, b) {
      return String(a.time || '').localeCompare(String(b.time || ''));
    });

    function rows() {
      if (!jobs.length) {
        return '<div class="note">مفيش مهام في اليوم ده. اضغط «＋ مهمة جديدة» تحت عشان تضيف.</div>';
      }
      return '<div class="day-list">' + jobs.map(function (j) {
        var v = S.byId('vehicles', j.vehicleId);
        var crew = (j.crew || []).map(function (id) { return M.staffName(id); }).filter(Boolean);
        return '<button class="day-row" data-pick="' + esc(j._id) + '">' +
            '<span class="day-row-bar" style="background:' + esc(v ? (v.color || '#888') : '#c1121f') + '"></span>' +
            '<span class="day-row-main">' +
              '<span class="day-row-top">' +
                '<span class="day-row-t">' + esc(AMB.fmtTime(j.time)) + '</span>' +
                '<span class="day-row-v">' + esc(M.venueName(j.venueId)) + '</span>' +
              '</span>' +
              '<span class="day-row-sub">' +
                (v ? esc(v.name) : '<span class="tag bad">لم تُسند</span>') +
                (crew.length ? ' · ' + esc(crew.join('، ')) : '') +
                (Number(j.fee) > 0 ? ' · ' + esc(fmoney(j.fee)) : '') +
              '</span>' +
            '</span>' +
            '<span class="day-row-end">' + statusTag(j.status) + '</span>' +
          '</button>';
      }).join('') + '</div>';
    }

    var m = UI.modal({
      title: '▤ ' + AMB.fmtDay(iso) + (jobs.length ? ' — ' + jobs.length + ' مهمة' : ''),
      size: 'wide',
      body: rows(),
      buttons: [
        { text: '＋ مهمة جديدة', cls: 'pri', onClick: function () {
            setTimeout(function () { editAssignment(null, iso); }, 120); return true;
          } },
        { spacer: true }, { text: 'إغلاق' }
      ]
    });

    m.body.querySelectorAll('[data-pick]').forEach(function (b) {
      b.onclick = function () {
        var id = b.dataset.pick;
        m.close();
        setTimeout(function () { jobDetail(id); }, 120);
      };
    });
  }

  function calendarHTML(y, mo) {
    var first = new Date(y, mo, 1);
    var start = new Date(y, mo, 1 - first.getDay());
    var t = AMB.today();

    var h = '<div class="card"><div class="cal">';
    AMB.AR_DAYS.forEach(function (d) { h += '<div class="dow">' + d + '</div>'; });

    for (var i = 0; i < 42; i++) {
      var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      var iso = AMB.toISODay(d);
      var out = d.getMonth() !== mo;
      var jobs = M.assignmentsOn(iso);
      h += '<div class="day' + (out ? ' out' : '') + (iso === t ? ' now' : '') + '" data-day="' + iso + '" title="اضغط لإضافة مهمة">' +
           '<span class="dn">' + d.getDate() + '</span>';
      jobs.slice(0, 3).forEach(function (j) {
        var v = S.byId('vehicles', j.vehicleId);
        var cls = j.status === 'منتهية' || j.status === 'ملغاة' ? ' done' : (j.status === 'جارية' ? ' live' : '');
        h += '<div class="ev' + cls + '" data-job="' + j._id + '" style="--c:' + esc(v ? (v.color || '#888') : '#c1121f') + '" ' +
             'title="' + esc(M.venueName(j.venueId) + ' — ' + AMB.fmtTime(j.time) + ' — ' + (v ? v.name : 'بدون سيارة')) + '">' +
             esc(shortTime(j.time)) + ' ' + esc(M.venueName(j.venueId)) + '</div>';
      });
      if (jobs.length > 3) h += '<div class="more">+ ' + (jobs.length - 3) + ' أخرى</div>';
      /* الخانة كلها بتفتح شاشة اليوم، فالمهام الزيادة مبقتش مخفية */
      h += '</div>';
    }
    h += '</div></div>';
    return h;
  }

  function shortTime(t) {
    if (!t) return '';
    var p = t.split(':'), hh = +p[0];
    var s = hh < 12 ? 'ص' : 'م'; var h12 = hh % 12 || 12;
    return h12 + (p[1] !== '00' ? ':' + p[1] : '') + s;
  }

  function listHTML(y, mo) {
    var from = AMB.toISODay(new Date(y, mo, 1));
    var to = AMB.toISODay(new Date(y, mo + 1, 0));
    var jobs = M.assignmentsBetween(from, to);
    if (!jobs.length) return '<div class="card"><div class="card-b tight">' +
      UI.empty('▤', 'مفيش مهام في الشهر ده', 'اضغط «+ مهمة جديدة»') + '</div></div>';

    var h = '<div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr>' +
      '<th>اليوم</th><th>الوقت</th><th>الملعب</th><th>السيارة</th><th>الطاقم</th><th>المبلغ</th><th>التحصيل</th><th>الحالة</th><th></th>' +
      '</tr></thead><tbody>';
    var lastDate = '';
    jobs.forEach(function (j) {
      var v = S.byId('vehicles', j.vehicleId);
      h += '<tr>' +
        '<td class="nowrap">' + (j.date !== lastDate ? esc(AMB.fmtDayShort(j.date)) : '<span class="muted">،،</span>') + '</td>' +
        '<td class="num nowrap">' + esc(AMB.fmtTime(j.time)) + '</td>' +
        '<td>' + esc(M.venueName(j.venueId)) + '</td>' +
        '<td class="nowrap">' + (v ? '<span class="swatch" style="background:' + esc(v.color) + '"></span>' + esc(v.name) : '<span class="tag bad">لم تُسند</span>') + '</td>' +
        '<td class="small">' + ((j.crew || []).map(function (id) { return esc(M.staffName(id)); }).join('، ') || '<span class="muted">—</span>') + '</td>' +
        '<td class="num nowrap">' + (j.fee ? esc(fmoney(j.fee)) : '—') + '</td>' +
        '<td class="nowrap">' + (Number(j.fee) > 0 && j.status !== 'ملغاة' ? payTag(j) : '<span class="muted">—</span>') + '</td>' +
        '<td>' + statusTag(j.status) + '</td>' +
        '<td class="acts no-print nowrap"><button class="btn sm" data-job="' + j._id + '">تفاصيل</button> ' +
          '<button class="btn sm danger" data-jdel="' + j._id + '" title="حذف أو إلغاء">🗑</button></td>' +
      '</tr>';
      lastDate = j.date;
    });
    h += '</tbody></table></div></div>';
    return h;
  }

  function exportSchedule(y, mo) {
    var from = AMB.toISODay(new Date(y, mo, 1));
    var to = AMB.toISODay(new Date(y, mo + 1, 0));
    var rows = [['اليوم', 'التاريخ', 'الوقت', 'الملعب', 'السيارة', 'الطاقم', 'المبلغ',
                 'حالة التحصيل', 'طريقة الدفع', 'المستلم', 'الباقي', 'الحالة', 'ملاحظات']];
    M.assignmentsBetween(from, to).forEach(function (j) {
      var d = AMB.parseDay(j.date);
      rows.push([
        AMB.AR_DAYS[d.getDay()], j.date, j.time, M.venueName(j.venueId), M.vehicleName(j.vehicleId),
        (j.crew || []).map(function (id) { return M.staffName(id); }).join(' / '),
        j.fee || '', payStatusOf(j), j.payMethod || '',
        j.payTo ? M.staffName(j.payTo) : '', dueAmount(j),
        j.status || 'مجدولة', j.notes || ''
      ]);
    });
    UI.downloadCSV('جدول-' + AMB.AR_MONTHS[mo] + '-' + y + '.csv', rows);
    AMB.toast('تم التصدير — افتحه بالإكسل', 'ok');
  }

  /* ============================================================
     التحصيل — فلوس كل مباراة اتدفعت ولا لأ
     ============================================================ */

  function payStatusOf(j) {
    var s = j.payStatus;
    return PAY_STATUS.indexOf(s) > -1 ? s : PAY.NONE;
  }

  /* المبلغ المحصّل فعلياً من المباراة */
  function paidAmount(j) {
    var st = payStatusOf(j);
    if (st === PAY.NONE || st === PAY.LATER) return 0;
    var a = Number(j.payAmount);
    return a > 0 ? a : (Number(j.fee) || 0);
  }

  /* الباقي على النادي */
  function dueAmount(j) {
    return Math.max(0, (Number(j.fee) || 0) - paidAmount(j));
  }

  function payTag(j, withAmount) {
    var st = payStatusOf(j);
    var cls = st === PAY.IN ? 'ok' : st === PAY.DRIVER ? 'warn' : st === PAY.LATER ? 'info' : 'bad';
    var txt = st;
    if (st === PAY.DRIVER && j.payTo) txt += ' ' + M.staffName(j.payTo);
    if (st === PAY.LATER && j.payDue) txt += ' حتى ' + AMB.fmtDayShort(j.payDue);
    if (withAmount && paidAmount(j) && paidAmount(j) !== (Number(j.fee) || 0)) {
      txt += ' (' + num(paidAmount(j), 0) + ' من ' + num(j.fee, 0) + ')';
    }
    return '<span class="tag ' + cls + ' dot">' + esc(txt) + '</span>';
  }

  /* المباريات اللي بتتحسب في الفلوس — الملغاة و اللي مبلغها صفر مالهاش لازمة */
  function billable(list) {
    return list.filter(function (j) { return j.status !== 'ملغاة' && (Number(j.fee) || 0) > 0; });
  }

  /* مباراة تُعتبر «مستحقة» بعد ما تعدّي — قبل كده هي متوقَّعة مش متأخرة */
  function isDue(j) {
    var t = AMB.today();
    if (j.date > t) return false;
    var st = payStatusOf(j);
    if (st === PAY.IN || st === PAY.DRIVER) return dueAmount(j) > 0;
    if (st === PAY.LATER) return !!(j.payDue && j.payDue < t);   // بس اللي عدّى الموعد المتفق عليه
    return true;
  }

  function payTotals(jobs) {
    var t = { fee: 0, collected: 0, withDriver: 0,
              due: 0, upcoming: 0, deferredFuture: 0,
              nDue: 0, nUpcoming: 0, nDriver: 0, nIn: 0, nLater: 0 };
    var today = AMB.today();
    billable(jobs).forEach(function (j) {
      var fee = Number(j.fee) || 0;
      var st = payStatusOf(j);
      t.fee += fee;
      if (st === PAY.IN) t.nIn++;
      else if (st === PAY.DRIVER) t.nDriver++;
      else if (st === PAY.LATER) t.nLater++;

      if (st === PAY.IN) t.collected += paidAmount(j);
      if (st === PAY.DRIVER) t.withDriver += paidAmount(j);

      var rem = dueAmount(j);
      if (!rem) return;
      if (isDue(j)) { t.due += rem; t.nDue++; }
      else { t.upcoming += rem; t.nUpcoming++; if (st === PAY.LATER) t.deferredFuture += rem; }
    });
    return t;
  }

  /* نافذة التحصيل السريع */
  function collectPayment(id, after) {
    var j = S.byId('assignments', id);
    if (!j || j._del) return;
    var staff = S.all('staff').sort(byName);
    var cur = payStatusOf(j);
    var ids = {};
    function F(o) { ids[o.key] = { id: AMB.uid('f'), type: o.type }; o.id = ids[o.key].id; return UI.field(o); }

    var body =
      '<div class="row" style="margin-bottom:6px">' +
        '<div><div class="small muted">المباراة</div><strong>' + esc(M.venueName(j.venueId)) + '</strong></div>' +
        '<div><div class="small muted">الموعد</div><strong>' + esc(AMB.fmtDayShort(j.date)) + ' — ' + esc(AMB.fmtTime(j.time)) + '</strong></div>' +
        '<div><div class="small muted">المبلغ المتفق عليه</div><strong>' + esc(fmoney(j.fee)) + '</strong></div>' +
      '</div>' +
      '<div class="field"><label>الحالة</label><div class="seg" id="_st" style="margin:0">' +
        PAY_STATUS.map(function (s) {
          return '<button type="button" data-s="' + esc(s) + '" class="' + (s === cur ? 'on' : '') + '">' + esc(s) + '</button>';
        }).join('') +
      '</div></div>' +
      '<div id="_paid">' +
        '<div class="row">' +
          F({ key: 'payMethod', label: 'طريقة الدفع', type: 'select', value: j.payMethod || 'كاش', options: PAY_METHODS }) +
          F({ key: 'payAmount', label: 'المبلغ المستلم (ج)', type: 'number', value: j.payAmount || j.fee || '', min: 0,
              hint: 'سيبه زي ما هو لو استلمت المبلغ كامل' }) +
          F({ key: 'payDate', label: 'تاريخ الاستلام', type: 'date', value: j.payDate || AMB.today() }) +
        '</div>' +
        '<div id="_who">' +
          F({ key: 'payTo', label: 'مين استلم الفلوس؟', type: 'select', value: j.payTo || '',
              options: [{ value: '', text: '— اختر —' }].concat(staff.map(function (s) {
                return { value: s._id, text: s.name + (s.role ? ' — ' + s.role : '') }; })) }) +
        '</div>' +
        '<div id="_ref">' +
          F({ key: 'payRef', label: 'رقم التحويل / الشيك', value: j.payRef, placeholder: 'اختياري — للرجوع إليه' }) +
        '</div>' +
      '</div>' +
      '<div id="_later">' +
        F({ key: 'payDue', label: 'النادي هيدفع في تاريخ', type: 'date', value: j.payDue || '',
            hint: 'النظام هينبهك لما الموعد يقرب أو يعدّي' }) +
      '</div>' +
      F({ key: 'payNotes', label: 'ملاحظات', value: j.payNotes, placeholder: 'مثلاً: اتفقنا مع أ. محمد على الدفع بعد الماتش الجاي' });

    var m = UI.modal({
      title: '₤ تحصيل مباراة', body: body,
      buttons: [
        { text: 'حفظ', cls: 'pri', keepOpen: true, onClick: function (api) {
            var d = UI.readForm(api.body, ids);
            var st = api.body.querySelector('#_st .on').dataset.s;

            if (st === PAY.DRIVER && !d.payTo) { AMB.toast('اختار مين استلم الفلوس', 'error'); return false; }
            if (st === PAY.LATER && !d.payDue) { AMB.toast('حدد تاريخ الدفع المتفق عليه', 'error'); return false; }

            j.payStatus = st;
            if (st === PAY.NONE) {
              j.payMethod = ''; j.payAmount = 0; j.payDate = ''; j.payTo = ''; j.payRef = ''; j.payDue = '';
            } else if (st === PAY.LATER) {
              j.payMethod = ''; j.payAmount = 0; j.payDate = ''; j.payTo = ''; j.payRef = '';
              j.payDue = d.payDue;
            } else {
              j.payMethod = d.payMethod;
              j.payAmount = Number(d.payAmount) || Number(j.fee) || 0;
              j.payDate = d.payDate || AMB.today();
              j.payTo = (st === PAY.DRIVER || d.payMethod === 'كاش') ? d.payTo : '';
              j.payRef = d.payRef;
              j.payDue = '';
            }
            j.payNotes = d.payNotes;
            S.put('assignments', j);
            api.close();
            AMB.toast('تم حفظ حالة التحصيل: ' + st, 'ok');
            if (after) after();
            return true;
          } },
        { spacer: true }, { text: 'إلغاء' }
      ]
    });

    function refresh() {
      var st = m.body.querySelector('#_st .on').dataset.s;
      var method = m.body.querySelector('#' + ids.payMethod.id).value;
      m.body.querySelector('#_paid').style.display = (st === PAY.IN || st === PAY.DRIVER) ? '' : 'none';
      m.body.querySelector('#_later').style.display = (st === PAY.LATER) ? '' : 'none';
      m.body.querySelector('#_who').style.display = (st === PAY.DRIVER || method === 'كاش') ? '' : 'none';
      m.body.querySelector('#_ref').style.display = (method === 'تحويل بنكي' || method === 'شيك' || method === 'انستاباي / محفظة') ? '' : 'none';
      if (st === PAY.DRIVER) m.body.querySelector('#' + ids.payMethod.id).value = 'كاش';
    }
    m.body.querySelectorAll('#_st button').forEach(function (b) {
      b.onclick = function () {
        m.body.querySelectorAll('#_st button').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        refresh();
      };
    });
    m.body.querySelector('#' + ids.payMethod.id).onchange = refresh;
    refresh();
  }

  /* ---------- استيراد جدول المباريات ---------- */

  /* تطبيع الأسماء العربية عشان المطابقة تنجح رغم اختلاف الهمزات والتاء المربوطة */
  function normAr(s) {
    return String(s || '')
      .replace(/ـ/g, '')                 // تطويل
      .replace(/[ً-ْ]/g, '')        // تشكيل
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/\s+/g, ' ')
      .trim().toLowerCase();
  }

  /* قارئ CSV بسيط يدعم الحقول بين علامات تنصيص */
  function parseCSVLine(line) {
    var out = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (q) {
        if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',' || c === '\t' || c === ';') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map(function (x) { return x.trim(); });
  }

  function importSchedule() {
    var parsed = null;

    var body =
      '<div class="note">الصق سطور الجدول أو ارفع ملف CSV. كل سطر = مباراة واحدة، بالترتيب ده:' +
        '<div class="mono" style="margin-top:6px;font-size:.8rem">التاريخ , الوقت , النادي , المبلغ , ملاحظات</div>' +
        '<div class="small" style="margin-top:6px">مثال: <span class="mono">2026-09-04,17:00,الرحاب يد,1400</span>' +
        ' — التاريخ بصيغة سنة-شهر-يوم، والوقت بنظام 24 ساعة. المبلغ والملاحظات اختيارية.</div></div>' +
      '<div class="btn-row" style="margin-bottom:10px">' +
        '<button class="btn sm" id="_file">📄 ارفع ملف CSV</button>' +
        '<span class="spacer" style="flex:1"></span>' +
        '<button class="btn acc sm" id="_scan">تحليل ومعاينة</button>' +
      '</div>' +
      '<textarea id="_txt" rows="7" class="mono" dir="ltr" style="font-size:.8rem" ' +
        'placeholder="2026-08-29,16:30,سانتوس&#10;2026-09-04,17:00,الرحاب يد,1400"></textarea>' +
      '<div id="_prev"></div>';

    var m = UI.modal({
      title: '⤒ استيراد جدول المباريات', size: 'wide', body: body,
      buttons: [
        { text: 'استيراد', cls: 'pri', id: '_go', keepOpen: true, onClick: doImport },
        { spacer: true }, { text: 'إغلاق' }
      ]
    });

    var goBtn = m.foot.querySelector('#_go');
    goBtn.disabled = true;

    m.body.querySelector('#_file').onclick = function () {
      UI.pickFile('.csv,.txt,text/csv,text/plain').then(function (f) {
        if (!f) return;
        var fr = new FileReader();
        fr.onload = function () {
          m.body.querySelector('#_txt').value = String(fr.result).replace(/^﻿/, '');
          scan();
        };
        fr.readAsText(f, 'utf-8');
      });
    };
    m.body.querySelector('#_scan').onclick = scan;

    function scan() {
      var txt = m.body.querySelector('#_txt').value;
      var lines = txt.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
      var venues = S.all('venues');
      var existing = S.all('assignments');

      var ok = [], bad = [], newClubs = {};

      lines.forEach(function (line, idx) {
        var c = parseCSVLine(line);
        // تخطَّ سطر العناوين
        if (idx === 0 && /التاريخ|date/i.test(c[0])) return;
        if (c.length < 3) { bad.push({ line: line, why: 'السطر ناقص — محتاج على الأقل تاريخ ووقت ونادي' }); return; }

        var date = c[0], time = c[1], club = c[2];
        var fee = c[3] ? Number(String(c[3]).replace(/[^\d.]/g, '')) || 0 : 0;
        var note = c[4] || '';

        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { bad.push({ line: line, why: 'صيغة التاريخ غلط (المطلوب 2026-09-04)' }); return; }
        var dt = AMB.parseDay(date);
        if (!dt || isNaN(dt.getTime())) { bad.push({ line: line, why: 'تاريخ غير موجود' }); return; }

        var tm = time.match(/^(\d{1,2}):(\d{2})$/);
        if (!tm || +tm[1] > 23 || +tm[2] > 59) { bad.push({ line: line, why: 'صيغة الوقت غلط (المطلوب 17:00)' }); return; }
        time = String(+tm[1]).padStart(2, '0') + ':' + tm[2];

        if (!club) { bad.push({ line: line, why: 'اسم النادي فاضي' }); return; }

        var venue = null, n = normAr(club);
        for (var i = 0; i < venues.length; i++) if (normAr(venues[i].name) === n) { venue = venues[i]; break; }
        if (!venue) newClubs[club] = true;

        var dup = existing.some(function (a) {
          return a.date === date && a.time === time && venue && a.venueId === venue._id;
        });

        ok.push({ date: date, time: time, club: club, venue: venue, fee: fee, note: note, dup: dup });
      });

      parsed = { ok: ok, bad: bad, newClubs: Object.keys(newClubs) };
      renderPreview();
    }

    function renderPreview() {
      var p = parsed, h = '';
      var fresh = p.ok.filter(function (r) { return !r.dup; });
      var dups = p.ok.length - fresh.length;

      h += '<h3 style="font-size:.95rem;margin:16px 0 8px">المعاينة</h3>';
      h += '<div class="grid g4" style="margin-bottom:12px">' +
        stat('هيتضاف', fresh.length, 'مباراة جديدة', '#17864a') +
        stat('موجود بالفعل', dups, dups ? 'هيتخطّى' : '', '#8b97a8') +
        stat('أندية جديدة', p.newClubs.length, p.newClubs.length ? 'هتتعمل تلقائياً' : '', '#a86300') +
        stat('سطور بها خطأ', p.bad.length, p.bad.length ? 'هتتجاهل' : 'مفيش', p.bad.length ? '#c1121f' : '#17864a') +
        '</div>';

      if (p.newClubs.length) {
        h += '<div class="note warn">الأندية دي مش موجودة عندك وهتتعمل جديدة: <strong>' +
          esc(p.newClubs.join('، ')) + '</strong><br>' +
          '<span class="small">هتتعمل من غير موقع على الخريطة — لازم تحدده بعدين من شاشة «الملاعب والأندية» ' +
          'عشان تسجيل الحضور يشتغل ليها.</span></div>';
      }

      if (p.bad.length) {
        h += '<div class="note bad"><strong>سطور هتتجاهل:</strong><ul style="margin:6px 0 0">' +
          p.bad.slice(0, 8).map(function (b) {
            return '<li class="small"><span class="mono">' + esc(b.line.slice(0, 60)) + '</span> — ' + esc(b.why) + '</li>';
          }).join('') +
          (p.bad.length > 8 ? '<li class="small">و ' + (p.bad.length - 8) + ' سطر آخر</li>' : '') +
          '</ul></div>';
      }

      if (fresh.length) {
        h += '<div class="tbl-wrap" style="max-height:260px;overflow-y:auto;border:1px solid var(--line);border-radius:9px">' +
          '<table class="tbl"><thead><tr><th>اليوم</th><th>الوقت</th><th>النادي</th><th>المبلغ</th></tr></thead><tbody>' +
          fresh.map(function (r) {
            return '<tr><td class="nowrap">' + esc(AMB.fmtDayShort(r.date)) + '</td>' +
              '<td class="num nowrap">' + esc(AMB.fmtTime(r.time)) + '</td>' +
              '<td>' + esc(r.club) + (r.venue ? '' : ' <span class="tag warn">جديد</span>') + '</td>' +
              '<td class="num nowrap">' + (r.fee ? esc(fmoney(r.fee)) : '<span class="muted">—</span>') + '</td></tr>';
          }).join('') + '</tbody></table></div>';
      } else if (!p.bad.length) {
        h += '<div class="note">مفيش حاجة جديدة تتضاف — كل المباريات دي موجودة عندك بالفعل.</div>';
      }

      m.body.querySelector('#_prev').innerHTML = h;
      goBtn.disabled = !fresh.length;
      goBtn.textContent = fresh.length ? 'استيراد ' + fresh.length + ' مباراة' : 'استيراد';
    }

    function doImport(api) {
      if (!parsed) { AMB.toast('اضغط «تحليل ومعاينة» الأول', 'warn'); return false; }
      var fresh = parsed.ok.filter(function (r) { return !r.dup; });
      if (!fresh.length) { AMB.toast('مفيش مباريات جديدة', 'warn'); return false; }

      /* اعمل الأندية الناقصة مرة واحدة */
      var made = {};
      fresh.forEach(function (r) {
        if (r.venue) return;
        var key = normAr(r.club);
        if (!made[key]) {
          made[key] = S.put('venues', {
            name: r.club, address: '', lat: null, lng: null,
            radius: 200, contact: '', phone: '', defaultFee: r.fee || 0, notes: 'أُضيف تلقائياً عند استيراد الجدول'
          });
        }
        r.venue = made[key];
      });

      fresh.forEach(function (r) {
        S.put('assignments', {
          date: r.date, time: r.time, duration: 120,
          venueId: r.venue._id, vehicleId: '', crew: [],
          fee: r.fee || r.venue.defaultFee || 0,
          status: 'مجدولة', notes: r.note,
          payStatus: PAY.NONE
        });
      });

      api.close();
      AMB.toast('تم استيراد ' + fresh.length + ' مباراة' +
                (Object.keys(made).length ? ' و' + Object.keys(made).length + ' نادي جديد' : ''), 'ok', 6000);

      /* اتنقل لشهر أول مباراة عشان يشوف النتيجة */
      var first = fresh.map(function (r) { return r.date; }).sort()[0];
      var d = AMB.parseDay(first);
      calMonth = new Date(d.getFullYear(), d.getMonth(), 1);
      go('schedule');
      return true;
    }
  }

  /* ---------- محرّر المهمة ---------- */

  function editAssignment(id, defaultDate) {
    var rec = id ? Object.assign({}, S.byId('assignments', id)) : {
      date: defaultDate || AMB.today(), time: '16:30', duration: 120,
      venueId: '', vehicleId: '', crew: [], fee: '', status: 'مجدولة', notes: ''
    };

    var venues = S.all('venues').sort(byOrder);   // بالأولوية اللي رتّبتها
    var vehicles = S.all('vehicles').sort(byName);
    var staff = S.all('staff').sort(byName);

    if (!venues.length) {
      AMB.toast('أضف الملاعب الأول من شاشة «الملاعب والأندية»', 'warn');
      go('venues'); return;
    }

    var ids = {};
    function F(o) { ids[o.key] = { id: AMB.uid('f'), type: o.type }; o.id = ids[o.key].id; return UI.field(o); }

    var body =
      '<div class="row">' +
        F({ key: 'date', label: 'التاريخ', type: 'date', value: rec.date, req: true }) +
        F({ key: 'time', label: 'وقت المباراة', type: 'time', value: rec.time, req: true }) +
        F({ key: 'duration', label: 'المدة (دقيقة)', type: 'number', value: rec.duration || 120, min: 30, step: 15 }) +
      '</div>' +
      F({ key: 'venueId', label: 'الملعب / النادي', type: 'select', req: true, value: rec.venueId,
          options: [{ value: '', text: '— اختر —' }].concat(venues.map(function (v) {
            return { value: v._id, text: v.name + (v.lat == null ? '  ⚠ بدون موقع' : '') };
          })) }) +
      '<div class="row">' +
        F({ key: 'vehicleId', label: 'السيارة', type: 'select', value: rec.vehicleId,
            options: [{ value: '', text: '— لم تُسند بعد —' }].concat(vehicles.map(function (v) {
              return { value: v._id, text: v.name + (v.status !== 'متاح' ? ' (' + v.status + ')' : '') };
            })) }) +
        F({ key: 'fee', label: 'مبلغ التأمين (ج)', type: 'number', value: rec.fee, min: 0, step: 50 }) +
      '</div>' +
      F({ key: 'crew', label: 'الطاقم المكلَّف', type: 'checks', value: rec.crew || [],
          options: staff.map(function (s) { return { value: s._id, text: s.name + ' — ' + (s.role || '') }; }) }) +
      (staff.length ? '' : '<div class="note warn">مفيش أفراد مسجلين — ضيفهم من شاشة «المسعفين والسواقين» عشان تقدر تكلّفهم وتتابع حضورهم.</div>') +
      F({ key: 'status', label: 'الحالة', type: 'select', value: rec.status || 'مجدولة', options: JOB_STATUS }) +
      F({ key: 'notes', label: 'ملاحظات', type: 'textarea', value: rec.notes, rows: 2,
          placeholder: 'مثلاً: بوابة 3 — التواصل مع أ. محمد 010...' }) +
      (id ? '<div class="field"><label>التحصيل</label>' +
              '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 12px;' +
              'background:var(--panel2);border:1px solid var(--line);border-radius:8px">' +
              payTag(rec, true) +
              (dueAmount(rec) ? '<span class="small">الباقي ' + esc(fmoney(dueAmount(rec))) + '</span>' : '') +
              '<span style="flex:1"></span>' +
              '<button type="button" class="btn sm acc" id="_pay">₤ تسجيل تحصيل</button></div></div>'
          : '') +
      '<div id="_warn"></div>';

    var btns = [
      { text: id ? 'حفظ التعديل' : 'إضافة المهمة', cls: 'pri', keepOpen: true, onClick: save }
    ];
    if (id) btns.push({ text: '🗑 حذف / إلغاء', cls: 'danger', onClick: function () {
      setTimeout(function () { deleteAssignment(id); }, 140);
    } });
    btns.push({ spacer: true });
    btns.push({ text: 'إغلاق' });

    var m = UI.modal({ title: id ? 'تعديل مهمة' : 'مهمة جديدة', body: body, buttons: btns });

    /* تعبئة تلقائية لسعر الملعب الافتراضي */
    var venueSel = m.body.querySelector('#' + ids.venueId.id);
    var feeInp = m.body.querySelector('#' + ids.fee.id);
    venueSel.addEventListener('change', function () {
      var v = S.byId('venues', this.value);
      if (v && v.defaultFee && !feeInp.value) feeInp.value = v.defaultFee;
      checkWarn();
    });
    [ids.date.id, ids.time.id, ids.vehicleId.id].forEach(function (i) {
      m.body.querySelector('#' + i).addEventListener('change', checkWarn);
    });
    m.body.querySelector('#' + ids.crew.id).addEventListener('change', checkWarn);
    checkWarn();

    var payBtn = m.body.querySelector('#_pay');
    if (payBtn) payBtn.onclick = function () {
      /* احفظ المبلغ الحالي الأول عشان نافذة التحصيل تشوفه */
      var d = collect();
      Object.assign(rec, d);
      S.put('assignments', rec);
      m.close();
      setTimeout(function () { collectPayment(id, function () { editAssignment(id); }); }, 140);
    };

    function collect() {
      var d = UI.readForm(m.body, ids);
      d.fee = d.fee === '' || d.fee == null ? 0 : Number(d.fee);
      d.duration = Number(d.duration) || 120;
      return d;
    }

    function checkWarn() {
      var d = collect(); d._id = id;
      var w = '';
      var cv = M.conflicts(d);
      if (cv.length) {
        w += '<div class="note bad">⚠ <strong>تعارض سيارة:</strong> ' + esc(M.vehicleName(d.vehicleId)) +
             ' مكلَّفة كمان بـ ' + cv.map(function (a) { return esc(M.venueName(a.venueId) + ' ' + AMB.fmtTime(a.time)); }).join('، ') + '</div>';
      }
      var cc = M.crewConflicts(d);
      if (cc.length) {
        var names = {};
        cc.forEach(function (c) { c.staff.forEach(function (s) { names[M.staffName(s)] = 1; }); });
        w += '<div class="note warn">⚠ <strong>تعارض طاقم:</strong> ' + esc(Object.keys(names).join('، ')) + ' مكلَّفين في نفس الوقت بمهمة تانية.</div>';
      }
      var vn = S.byId('venues', d.venueId);
      if (vn && vn.lat == null) {
        w += '<div class="note warn">📍 ملعب <strong>' + esc(vn.name) + '</strong> لسه من غير موقع — تسجيل الحضور بالموقع مش هيشتغل. ' +
             '<button class="btn sm" id="_setloc" style="margin-top:6px">حدد موقعه دلوقتي</button></div>';
      }
      m.body.querySelector('#_warn').innerHTML = w;
      var sl = m.body.querySelector('#_setloc');
      if (sl) sl.onclick = function () {
        UI.pickLocation({ title: 'موقع ' + vn.name, label: vn.name, radius: vn.radius || 200,
          others: S.all('venues').filter(function (x) { return x.lat != null; })
        }).then(function (r) {
          if (!r) return;
          vn.lat = r.lat; vn.lng = r.lng; vn.radius = r.radius;
          S.put('venues', vn); AMB.toast('تم حفظ موقع ' + vn.name, 'ok'); checkWarn();
        });
      };
    }

    function save(api) {
      var d = collect();
      if (!d.date) { AMB.toast('التاريخ مطلوب', 'error'); return false; }
      if (!d.time) { AMB.toast('الوقت مطلوب', 'error'); return false; }
      if (!d.venueId) { AMB.toast('اختر الملعب', 'error'); return false; }
      Object.assign(rec, d);
      S.put('assignments', rec);
      api.close();
      AMB.toast(id ? 'تم حفظ التعديل' : 'تمت إضافة المهمة', 'ok');
      return true;
    }
  }

  /* ---------- حذف / إلغاء مهمة ---------- */

  function deleteAssignment(id, after) {
    var j = S.byId('assignments', id);
    if (!j || j._del) return;

    var att = M.attendanceFor(id);
    var paid = paidAmount(j);
    var label = M.venueName(j.venueId) + ' — ' + AMB.fmtDayShort(j.date) + ' ' + AMB.fmtTime(j.time);

    var warn = '';
    if (att.length) {
      warn += '<div class="note warn">⚠ فيه <strong>' + att.length + ' تسجيل حضور</strong> مربوط بالمباراة دي. ' +
              'الحذف النهائي هيمسحهم معاها.</div>';
    }
    if (paid) {
      warn += '<div class="note bad">⚠ المباراة دي متسجّل عليها <strong>تحصيل ' + esc(fmoney(paid)) + '</strong>. ' +
              'متمسحهاش لو الفلوس اتقبضت فعلاً — الأصح تخليها موجودة.</div>';
    }

    var body =
      '<p style="margin:0 0 4px">المباراة: <strong>' + esc(label) + '</strong></p>' +
      '<p class="small muted">' + (Number(j.fee) ? esc(fmoney(j.fee)) : 'بدون مبلغ') + ' · ' + esc(j.status || 'مجدولة') + '</p>' +
      warn +
      '<div style="display:grid;gap:10px;margin-top:14px">' +
        '<button class="btn" id="_cancel" style="text-align:start;padding:13px 15px;height:auto">' +
          '<div><strong>إلغاء المباراة</strong>' +
          '<div class="small muted" style="font-weight:400;margin-top:3px">المباراة كانت حقيقية بس اتلغت. ' +
          'هتفضل في السجل والتقويم بعلامة «ملغاة»، ومش هتتحسب في الفلوس.</div></div></button>' +
        '<button class="btn danger" id="_wipe" style="text-align:start;padding:13px 15px;height:auto">' +
          '<div><strong>حذف نهائي</strong>' +
          '<div class="small muted" style="font-weight:400;margin-top:3px">المباراة دي اتكتبت غلط ومكانش المفروض تتسجّل أصلاً. ' +
          'هتختفي تماماً من كل الشاشات والتقارير، ومفيش رجوع.</div></div></button>' +
      '</div>';

    var m = UI.modal({
      title: 'حذف أو إلغاء مباراة', body: body,
      buttons: [{ spacer: true }, { text: 'رجوع' }]
    });

    m.body.querySelector('#_cancel').onclick = function () {
      j.status = 'ملغاة';
      S.put('assignments', j);
      m.close();
      AMB.toast('تم إلغاء المباراة — فاضلة في السجل', 'ok');
      if (after) after();
    };

    m.body.querySelector('#_wipe').onclick = function () {
      m.close();
      setTimeout(function () {
        UI.confirm('حذف « ' + label + ' » نهائياً؟', {
          title: '🗑 حذف نهائي', danger: true, yes: 'أيوه، امسحها خالص',
          detail: (att.length ? att.length + ' تسجيل حضور هيتمسحوا معاها. ' : '') +
                  'مفيش تراجع بعد كده — إلا لو عندك نسخة احتياطية.'
        }).then(function (ok) {
          if (!ok) return;
          att.forEach(function (r) { S.remove('attendance', r._id); });
          S.remove('assignments', id);
          AMB.toast('تم الحذف النهائي', 'ok');
          if (after) after();
        });
      }, 140);
    };
  }

  /* ---------- تفاصيل المهمة ---------- */

  function jobDetail(id) {
    var j = S.byId('assignments', id);
    if (!j || j._del) { AMB.toast('المهمة غير موجودة', 'error'); return; }
    var venue = M.venue(j.venueId);
    var att = M.attendanceFor(id);
    var st = S.settings();

    var h = '<div class="row" style="margin-bottom:14px">' +
      '<div><div class="small muted">الملعب</div><div style="font-weight:700;font-size:1.05rem">' + esc(M.venueName(j.venueId)) + '</div></div>' +
      '<div><div class="small muted">الموعد</div><div style="font-weight:700">' + esc(AMB.fmtDayShort(j.date)) + ' — ' + esc(AMB.fmtTime(j.time)) + '</div></div>' +
      '<div><div class="small muted">السيارة</div><div style="font-weight:700">' + esc(M.vehicleName(j.vehicleId)) + '</div></div>' +
      '<div><div class="small muted">المبلغ</div><div style="font-weight:700">' + (j.fee ? esc(fmoney(j.fee)) : '—') + '</div></div>' +
      '</div>';

    h += '<div style="margin-bottom:12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">' + statusTag(j.status) +
         (Number(j.fee) > 0 && j.status !== 'ملغاة' ? payTag(j, true) : '') +
         (j.payNotes ? '<span class="small muted">' + esc(j.payNotes) + '</span>' : '') +
         (j.notes ? '<span class="small muted">' + esc(j.notes) + '</span>' : '') + '</div>';

    /* الطاقم وحالة الحضور */
    h += '<h3 style="font-size:.92rem;margin-top:16px">الطاقم وحالة الحضور</h3>';
    if (!(j.crew || []).length) {
      h += '<div class="note warn">مفيش طاقم مكلَّف بالمهمة دي.</div>';
    } else {
      h += '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>الفرد</th>' +
           CHECKS.map(function (c) { return '<th>' + c.ic + ' ' + esc(c.t) + '</th>'; }).join('') +
           '</tr></thead><tbody>';
      j.crew.forEach(function (sid) {
        h += '<tr><td><strong>' + esc(M.staffName(sid)) + '</strong></td>';
        CHECKS.forEach(function (c) {
          var r = att.filter(function (a) { return a.staffId === sid && a.kind === c.k; })[0];
          if (!r) h += '<td class="muted">—</td>';
          else {
            h += '<td class="num nowrap">' + esc(AMB.fmtClock(r.ts)) +
                 (r.valid === false ? ' <span class="tag bad" title="سُجّل على بُعد ' + esc(AMB.fmtDistance(r.distance)) + '">خارج النطاق</span>' : '') +
                 (r.method === 'يدوي' ? ' <span class="tag warn">يدوي</span>' : '') + '</td>';
          }
        });
        h += '</tr>';
      });
      h += '</tbody></table></div>';

      /* تحليل التأخير */
      var arrivals = att.filter(function (a) { return a.kind === 'arrive_venue'; });
      if (arrivals.length) {
        var first = arrivals.reduce(function (a, b) { return a.ts < b.ts ? a : b; });
        var target = AMB.parseDay(j.date);
        var tp = (j.time || '00:00').split(':');
        target.setHours(+tp[0], +tp[1] || 0, 0, 0);
        var mustBy = new Date(target.getTime() - (st.arriveBeforeMin || 30) * 60000);
        var diffMin = Math.round((first.ts - mustBy.getTime()) / 60000);
        if (diffMin <= 0) {
          h += '<div class="note ok">✓ أول وصول للملعب الساعة <strong>' + esc(AMB.fmtClock(first.ts)) +
               '</strong> — ' + (diffMin === 0 ? 'في الميعاد المطلوب بالظبط.'
                                               : 'قبل الموعد المطلوب بـ ' + esc(AMB.fmtMins(-diffMin)) + '.') + '</div>';
        } else if (diffMin <= (st.lateGraceMin || 15)) {
          h += '<div class="note warn">أول وصول الساعة <strong>' + esc(AMB.fmtClock(first.ts)) +
               '</strong> — متأخر ' + esc(AMB.fmtMins(diffMin)) + ' عن الموعد المطلوب (داخل فترة السماح).</div>';
        } else {
          h += '<div class="note bad">⚠ أول وصول الساعة <strong>' + esc(AMB.fmtClock(first.ts)) +
               '</strong> — <strong>متأخر ' + esc(AMB.fmtMins(diffMin)) + '</strong> عن الموعد المطلوب (' +
               esc(AMB.fmtClock(mustBy.getTime())) + ').</div>';
        }
      }
    }

    /* خريطة المسار */
    if (j.vehicleId) {
      var dayStart = AMB.parseDay(j.date).getTime();
      var trk = M.track(j.vehicleId, dayStart, dayStart + 86400000);
      h += '<h3 style="font-size:.92rem;margin-top:18px">مسار السيارة يوم المهمة</h3>';
      h += '<div id="_jmap" class="map-mid" style="border:1px solid var(--line)"></div>';
      h += '<div class="small muted" style="margin-top:6px">' + (trk.length ? trk.length + ' نقطة مسجلة' : 'لا توجد نقاط مسار مسجلة لهذا اليوم') + '</div>';
    }

    var m = UI.modal({
      title: 'تفاصيل المهمة', size: 'wide', body: h,
      buttons: [
        { text: '✎ تعديل', cls: 'acc', onClick: function () { setTimeout(function () { editAssignment(id); }, 120); } },
        { text: '₤ تحصيل', onClick: function () { setTimeout(function () { collectPayment(id, function () { jobDetail(id); }); }, 120); } },
        { text: '＋ تسجيل حضور يدوي', onClick: function () { setTimeout(function () { manualCheck(id); }, 120); } },
        { text: '🗑 حذف / إلغاء', cls: 'danger', onClick: function () { setTimeout(function () { deleteAssignment(id); }, 120); } },
        { spacer: true },
        { text: 'إغلاق' }
      ]
    });

    if (j.vehicleId) setTimeout(function () {
      var el = m.body.querySelector('#_jmap'); if (!el) return;
      var mp = new MiniMap(el, {});
      var dayStart2 = AMB.parseDay(j.date).getTime();
      var trk2 = M.track(j.vehicleId, dayStart2, dayStart2 + 86400000);
      var v = S.byId('vehicles', j.vehicleId);
      var mk = [], ci = [], ln = [];
      if (venue && venue.lat != null) {
        mk.push({ lat: venue.lat, lng: venue.lng, color: '#c1121f', kind: 'venue', label: venue.name });
        ci.push({ lat: venue.lat, lng: venue.lng, radius: venue.radius || 200, color: '#c1121f' });
      }
      if (st.garage && st.garage.lat != null) {
        mk.push({ lat: st.garage.lat, lng: st.garage.lng, color: '#7b61ff', kind: 'garage', label: 'الجراج' });
        ci.push({ lat: st.garage.lat, lng: st.garage.lng, radius: st.garage.radius || 200, color: '#7b61ff' });
      }
      if (trk2.length > 1) ln.push({ points: trk2, color: v ? v.color : '#e63946', width: 4 });
      att.forEach(function (a) {
        if (a.lat == null) return;
        var cd = checkDef(a.kind);
        mk.push({ lat: a.lat, lng: a.lng, color: cd ? cd.color : '#888', kind: 'point',
                  title: (cd ? cd.t : a.kind) + ' — ' + M.staffName(a.staffId) + ' — ' + AMB.fmtClock(a.ts) });
      });
      mp.setMarkers(mk); mp.setCircles(ci); mp.setLines(ln);
      mp.fit();
    }, 60);
  }

  /* تسجيل حضور يدوي من جهاز المدير */
  function manualCheck(assignmentId) {
    var j = S.byId('assignments', assignmentId);
    if (!j) return;
    var crew = (j.crew || []);
    if (!crew.length) { AMB.toast('كلّف الطاقم الأول', 'warn'); return; }
    var ids = {};
    function F(o) { ids[o.key] = { id: AMB.uid('f'), type: o.type }; o.id = ids[o.key].id; return UI.field(o); }

    var now = new Date();
    var body =
      '<div class="note warn">التسجيل اليدوي بيتحفظ من غير تحقق من الموقع، وبيتعلّم في السجل بعلامة «يدوي».</div>' +
      F({ key: 'staffId', label: 'الفرد', type: 'select', options: crew.map(function (s) { return { value: s, text: M.staffName(s) }; }) }) +
      F({ key: 'kind', label: 'نوع الحركة', type: 'select', options: CHECKS.map(function (c) { return { value: c.k, text: c.ic + ' ' + c.t }; }) }) +
      '<div class="row">' +
        F({ key: 'date', label: 'التاريخ', type: 'date', value: j.date }) +
        F({ key: 'time', label: 'الوقت', type: 'time', value: String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') }) +
      '</div>' +
      F({ key: 'note', label: 'سبب التسجيل اليدوي', type: 'text', placeholder: 'مثلاً: بطارية الموبايل فصلت' });

    UI.modal({
      title: 'تسجيل حضور يدوي', size: 'narrow', body: body,
      buttons: [{ text: 'تسجيل', cls: 'pri', keepOpen: true, onClick: function (api) {
        var d = UI.readForm(api.body, ids);
        var dt = AMB.parseDay(d.date); var tp = d.time.split(':');
        dt.setHours(+tp[0], +tp[1] || 0, 0, 0);
        S.put('attendance', {
          assignmentId: assignmentId, staffId: d.staffId, kind: d.kind,
          ts: dt.getTime(), lat: null, lng: null, distance: null, valid: null,
          method: 'يدوي', note: d.note, vehicleId: j.vehicleId
        });
        api.close();
        AMB.toast('تم التسجيل', 'ok');
        setTimeout(function () { jobDetail(assignmentId); }, 150);
      } }, { text: 'إلغاء' }]
    });
  }

  /* ============================================================
     3) الخريطة الحية
     ============================================================ */

  var liveSel = 'all';

  function viewLive(host) {
    var vehicles = S.all('vehicles');
    var st = S.settings();

    var h = '<div class="filters no-print">' +
      '<label>السيارة</label><select id="lvSel"><option value="all">كل السيارات</option>' +
      vehicles.map(function (v) { return '<option value="' + v._id + '"' + (liveSel === v._id ? ' selected' : '') + '>' + esc(v.name) + '</option>'; }).join('') +
      '</select>' +
      '<label>عرض المسار</label><select id="lvTrail">' +
      '<option value="0">بدون</option><option value="1">آخر ساعة</option><option value="3" selected>آخر 3 ساعات</option><option value="24">اليوم كله</option>' +
      '</select>' +
      '<label><input type="checkbox" id="lvVenues" checked> الملاعب</label>' +
      '<span class="spacer"></span>' +
      '<span class="small muted" id="lvUpd"></span>' +
      '<button class="btn sm" id="lvFit">⤢ عرض الكل</button>' +
      '</div>';

    if (!Sync.config()) {
      h += '<div class="note warn"><strong>المزامنة اللحظية متوقفة.</strong> الخريطة هتعرض آخر بيانات محفوظة على الجهاز ده بس. ' +
           'فعّل المزامنة عشان تشوف السيارات وهي بتتحرك. <button class="btn sm" data-go="settings" style="margin-top:6px">تفعيل المزامنة</button></div>';
    }

    h += '<div class="card"><div id="liveMap" class="map-tall"></div></div>';
    h += '<div class="card"><div class="card-h"><h3>حالة السيارات</h3></div><div id="lvList"></div></div>';

    host.innerHTML = h;
    host.querySelectorAll('[data-go]').forEach(function (b) { b.onclick = function () { go(b.dataset.go); }; });

    liveMap = new MiniMap(host.querySelector('#liveMap'), {});
    var first = true;

    function draw() {
      if (!liveMap) return;
      var sel = host.querySelector('#lvSel').value;
      var trailH = Number(host.querySelector('#lvTrail').value);
      var showVenues = host.querySelector('#lvVenues').checked;

      var mk = [], ci = [], ln = [];

      if (st.garage && st.garage.lat != null) {
        mk.push({ lat: st.garage.lat, lng: st.garage.lng, color: '#7b61ff', kind: 'garage', label: st.garage.name || 'الجراج' });
        ci.push({ lat: st.garage.lat, lng: st.garage.lng, radius: st.garage.radius || 200, color: '#7b61ff' });
      }

      if (showVenues) {
        S.all('venues').forEach(function (v) {
          if (v.lat == null) return;
          mk.push({ lat: v.lat, lng: v.lng, color: '#8b97a8', kind: 'venue', title: v.name });
          ci.push({ lat: v.lat, lng: v.lng, radius: v.radius || 200, color: '#8b97a8', fillOpacity: .06 });
        });
      }

      var listH = '<ul class="list">';
      var shown = vehicles.filter(function (v) { return sel === 'all' || v._id === sel; });

      shown.forEach(function (v) {
        var p = M.lastPing(v._id);
        var job = M.currentAssignment(v._id);
        var fresh = p && (Date.now() - p.ts) < 180000;

        if (p) {
          mk.push({
            lat: p.lat, lng: p.lng, color: v.color || '#e63946', label: v.name, pulse: fresh,
            title: v.name + ' — ' + AMB.ago(p.ts) + (p.speed != null ? ' — ' + p.speed + ' كم/س' : '')
          });
          if (trailH > 0) {
            var trk = M.track(v._id, Date.now() - trailH * 3600000);
            if (trk.length > 1) ln.push({ points: trk, color: v.color || '#e63946', width: 3, opacity: .7 });
          }
        }

        var dist = null;
        if (p && job) {
          var vn = M.venue(job.venueId);
          if (vn && vn.lat != null) dist = AMB.distance(p.lat, p.lng, vn.lat, vn.lng);
        }
        var distGarage = (p && st.garage && st.garage.lat != null) ? AMB.distance(p.lat, p.lng, st.garage.lat, st.garage.lng) : null;

        listH += '<li>' +
          '<span class="swatch" style="width:14px;height:14px;background:' + esc(v.color || '#888') + '"></span>' +
          '<div style="flex:1;min-width:0">' +
            '<div class="ttl">' + esc(v.name) + '</div>' +
            '<div class="sub">' + (job ? 'متجهة إلى ' + esc(M.venueName(job.venueId)) + ' — ' + esc(AMB.fmtTime(job.time)) : 'بدون مهمة') +
            (dist != null ? ' · تبعد ' + esc(AMB.fmtDistance(dist)) + ' عن الملعب' : '') +
            (distGarage != null && distGarage < (st.garage.radius || 200) ? ' · <span class="tag info">في الجراج</span>' : '') + '</div>' +
          '</div>' +
          '<div style="text-align:end">' +
            (p ? '<div class="ttl small ' + (fresh ? '' : 'muted') + '">' + (fresh ? '<span style="color:var(--ok)">◉ مباشر</span>' : esc(AMB.ago(p.ts))) + '</div>' +
                 '<div class="sub mono">' + (p.speed != null ? p.speed + ' كم/س' : '') + (p.acc ? ' ±' + p.acc + 'م' : '') + '</div>'
               : '<span class="tag">لا إشارة</span>') +
          '</div>' +
        '</li>';
      });
      listH += '</ul>';
      if (!shown.length) listH = '<div class="card-b tight">' + UI.empty('▣', 'مفيش سيارات') + '</div>';

      host.querySelector('#lvList').innerHTML = listH;
      host.querySelector('#lvUpd').textContent = 'آخر تحديث ' + new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      liveMap.setMarkers(mk); liveMap.setCircles(ci); liveMap.setLines(ln);
      if (first && mk.length) { liveMap.fit(); first = false; }
    }

    host.querySelector('#lvSel').onchange = function () { liveSel = this.value; first = true; draw(); };
    host.querySelector('#lvTrail').onchange = draw;
    host.querySelector('#lvVenues').onchange = draw;
    host.querySelector('#lvFit').onclick = function () { liveMap.fit(); };

    draw();
    liveTimer = setInterval(draw, 10000);
  }

  /* ============================================================
     4) الحضور والانصراف
     ============================================================ */

  function viewAttend(host) {
    var d = new Date(); d.setDate(d.getDate() - 30);
    var defFrom = attFrom || AMB.toISODay(d);
    var defTo = attTo || AMB.today();

    var h = '<div class="filters no-print">' +
      '<label>من</label><input type="date" id="afFrom" value="' + defFrom + '">' +
      '<label>إلى</label><input type="date" id="afTo" value="' + defTo + '">' +
      '<label>الفرد</label><select id="afStaff"><option value="">الكل</option>' +
      S.all('staff').sort(byName).map(function (s) { return '<option value="' + s._id + '"' + (attStaff === s._id ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select>' +
      '<label>النوع</label><select id="afKind"><option value="">الكل</option>' +
      CHECKS.map(function (c) { return '<option value="' + c.k + '">' + esc(c.t) + '</option>'; }).join('') + '</select>' +
      '<label>يشمل</label><select id="afWho">' +
        '<option value="att">المسعفين فقط</option>' +
        '<option value="all">الكل — بما فيهم السواقين</option>' +
      '</select>' +
      '<span class="spacer"></span><button class="btn sm" id="afExp">⤓ تصدير</button></div>';

    var recs = S.all('attendance').filter(function (r) {
      var iso = AMB.toISODay(new Date(r.ts));
      if (iso < defFrom || iso > defTo) return false;
      if (attStaff && r.staffId !== attStaff) return false;
      if (attKind && r.kind !== attKind) return false;
      if (attWho !== 'all' && !M.countsAttendance(r.staffId)) return false;
      return true;
    }).sort(function (a, b) { return b.ts - a.ts; });

    if (attWho !== 'all') {
      var hidden = S.all('attendance').filter(function (r) {
        var iso = AMB.toISODay(new Date(r.ts));
        return iso >= defFrom && iso <= defTo && !M.countsAttendance(r.staffId);
      }).length;
      if (hidden) {
        h += '<div class="note">مخفي <strong>' + hidden + ' حركة</strong> للسواقين والفنيين — دي حركات سيارة مش حضور. ' +
             'غيّر «يشمل» لـ«الكل» لو عايز تشوفها.</div>';
      }
    }

    /* ملخص */
    var outside = recs.filter(function (r) { return r.valid === false; }).length;
    var manual = recs.filter(function (r) { return r.method === 'يدوي'; }).length;
    h += '<div class="grid g4" style="margin-bottom:14px">' +
      stat('إجمالي التسجيلات', recs.length, 'خلال الفترة', '#1d75d8') +
      stat('خارج النطاق', outside, outside ? 'محتاجة مراجعة' : 'الكل سليم', outside ? '#c1121f' : '#17864a') +
      stat('تسجيل يدوي', manual, 'بدون تحقق موقع', manual ? '#a86300' : '#17864a') +
      stat('أفراد نشطين', Object.keys(recs.reduce(function (a, r) { a[r.staffId] = 1; return a; }, {})).length, 'سجّلوا حركة', '#7b61ff') +
      '</div>';

    if (!recs.length) {
      h += '<div class="card"><div class="card-b tight">' +
           UI.empty('✓', 'مفيش سجلات حضور في الفترة دي',
                    'الحضور بيتسجل تلقائياً لما المسعف يدوس الأزرار من صفحة الموبايل') + '</div></div>';
    } else {
      h += '<div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr>' +
        '<th>التاريخ والوقت</th><th>الفرد</th><th>الحركة</th><th>المهمة</th><th>السيارة</th><th>المسافة</th><th>التحقق</th><th></th>' +
        '</tr></thead><tbody>';
      recs.slice(0, 400).forEach(function (r) {
        var c = checkDef(r.kind);
        var a = S.byId('assignments', r.assignmentId);
        h += '<tr>' +
          '<td class="num nowrap">' + esc(AMB.fmtStamp(r.ts)) + '</td>' +
          '<td>' + esc(M.staffName(r.staffId)) + '</td>' +
          '<td class="nowrap">' + (c ? c.ic + ' ' + esc(c.t) : esc(r.kind)) + '</td>' +
          '<td class="small">' + (a ? esc(M.venueName(a.venueId)) + ' <span class="muted">' + esc(AMB.fmtTime(a.time)) + '</span>' : '<span class="muted">—</span>') + '</td>' +
          '<td class="nowrap small">' + esc(M.vehicleName(r.vehicleId || (a && a.vehicleId))) + '</td>' +
          '<td class="num nowrap">' + esc(AMB.fmtDistance(r.distance)) + '</td>' +
          '<td>' + (r.method === 'يدوي' ? '<span class="tag warn">يدوي</span>'
                   : r.valid === true ? '<span class="tag ok">داخل النطاق</span>'
                   : r.valid === false ? '<span class="tag bad">خارج النطاق</span>' : '<span class="tag">—</span>') + '</td>' +
          '<td class="acts no-print">' + (r.lat != null ? '<button class="btn sm" data-att="' + r._id + '">📍</button>' : '') + '</td>' +
        '</tr>';
      });
      h += '</tbody></table></div>';
      if (recs.length > 400) h += '<div class="card-b small muted center">يُعرض أول 400 سجل — ضيّق الفترة أو صدّر الملف للاطلاع على الباقي</div>';
      h += '</div>';
    }

    host.innerHTML = h;

    host.querySelector('#afFrom').onchange = function () { attFrom = this.value; render(); };
    host.querySelector('#afTo').onchange = function () { attTo = this.value; render(); };
    host.querySelector('#afStaff').onchange = function () { attStaff = this.value; render(); };
    host.querySelector('#afKind').onchange = function () { attKind = this.value; render(); };
    host.querySelector('#afKind').value = attKind || '';
    host.querySelector('#afWho').value = attWho;
    host.querySelector('#afWho').onchange = function () { attWho = this.value; render(); };
    host.querySelector('#afExp').onclick = function () {
      var rows = [['التاريخ', 'الوقت', 'الفرد', 'الحركة', 'الملعب', 'السيارة', 'المسافة (م)', 'التحقق', 'خط العرض', 'خط الطول', 'ملاحظة']];
      recs.forEach(function (r) {
        var c = checkDef(r.kind); var a = S.byId('assignments', r.assignmentId);
        var dt = new Date(r.ts);
        rows.push([AMB.toISODay(dt), dt.toTimeString().slice(0, 5), M.staffName(r.staffId),
          c ? c.t : r.kind, a ? M.venueName(a.venueId) : '', M.vehicleName(r.vehicleId || (a && a.vehicleId)),
          r.distance == null ? '' : r.distance,
          r.method === 'يدوي' ? 'يدوي' : (r.valid === true ? 'داخل النطاق' : r.valid === false ? 'خارج النطاق' : ''),
          r.lat == null ? '' : r.lat, r.lng == null ? '' : r.lng, r.note || '']);
      });
      UI.downloadCSV('سجل-الحضور.csv', rows);
      AMB.toast('تم التصدير', 'ok');
    };

    host.querySelectorAll('[data-att]').forEach(function (b) {
      b.onclick = function () { showAttendPoint(b.dataset.att); };
    });
  }

  var attFrom = null, attTo = null, attStaff = '', attKind = '', attWho = 'att';

  function showAttendPoint(id) {
    var r = S.byId('attendance', id);
    if (!r) return;
    var a = S.byId('assignments', r.assignmentId);
    var vn = a ? M.venue(a.venueId) : null;
    var st = S.settings();
    var c = checkDef(r.kind);

    var m = UI.modal({
      title: (c ? c.ic + ' ' + c.t : 'تسجيل') + ' — ' + M.staffName(r.staffId),
      size: 'wide',
      body: '<div class="row" style="margin-bottom:12px">' +
        '<div><div class="small muted">الوقت</div><strong>' + esc(AMB.fmtStamp(r.ts)) + '</strong></div>' +
        '<div><div class="small muted">المسافة عن الهدف</div><strong>' + esc(AMB.fmtDistance(r.distance)) + '</strong></div>' +
        '<div><div class="small muted">دقة الجهاز</div><strong>' + (r.acc ? '±' + r.acc + ' م' : '—') + '</strong></div>' +
        '<div><div class="small muted">التحقق</div>' +
          (r.valid === true ? '<span class="tag ok">داخل النطاق</span>' : r.valid === false ? '<span class="tag bad">خارج النطاق</span>' : '<span class="tag">—</span>') +
        '</div></div>' +
        '<div id="_amap" class="map-mid" style="border:1px solid var(--line)"></div>' +
        '<div class="small mono muted center" style="margin-top:6px">' + (r.lat != null ? r.lat.toFixed(6) + ', ' + r.lng.toFixed(6) : '') + '</div>',
      buttons: [
        { text: 'فتح في جوجل مابس', onClick: function () {
            if (r.lat != null) window.open('https://www.google.com/maps?q=' + r.lat + ',' + r.lng, '_blank', 'noopener');
          } },
        { spacer: true }, { text: 'إغلاق' }
      ]
    });

    setTimeout(function () {
      var mp = new MiniMap(m.body.querySelector('#_amap'), {});
      var mk = [{ lat: r.lat, lng: r.lng, color: c ? c.color : '#c1121f', label: 'مكان التسجيل' }];
      var ci = [];
      var target = (c && c.ref === 'garage') ? st.garage : vn;
      if (target && target.lat != null) {
        mk.push({ lat: target.lat, lng: target.lng, color: '#1d75d8', kind: 'venue', label: target.name || 'الهدف' });
        ci.push({ lat: target.lat, lng: target.lng, radius: target.radius || 200, color: '#1d75d8' });
      }
      mp.setMarkers(mk); mp.setCircles(ci); mp.fit(50);
    }, 50);
  }

  /* ============================================================
     4ب) التحصيل والفلوس
     ============================================================ */

  var payFrom = null, payTo = null, payFilter = 'due', payVenue = '';

  function viewPay(host) {
    var d = new Date(); d.setMonth(d.getMonth() - 3);
    var from = payFrom || AMB.toISODay(d);
    var to = payTo || AMB.toISODay(new Date(Date.now() + 90 * 86400000));

    var all = billable(M.assignmentsBetween(from, to));
    var t = payTotals(all);

    var h = '<div class="filters no-print">' +
      '<label>من</label><input type="date" id="pyFrom" value="' + from + '">' +
      '<label>إلى</label><input type="date" id="pyTo" value="' + to + '">' +
      '<label>العرض</label><select id="pyF">' +
        '<option value="due">المتأخر فقط</option>' +
        '<option value="upcoming">مستحق لاحقاً</option>' +
        '<option value="all">الكل</option>' +
        '<option value="' + esc(PAY.DRIVER) + '">مع السواقين</option>' +
        '<option value="' + esc(PAY.IN) + '">المحصّل</option>' +
        '<option value="' + esc(PAY.LATER) + '">المؤجل</option>' +
      '</select>' +
      '<label>النادي</label><select id="pyV"><option value="">الكل</option>' +
        S.all('venues').sort(byOrder).map(function (v) {
          return '<option value="' + v._id + '"' + (payVenue === v._id ? ' selected' : '') + '>' + esc(v.name) + '</option>';
        }).join('') + '</select>' +
      '<span class="spacer"></span>' +
      '<button class="btn sm" id="pyPrint">🖨 طباعة</button>' +
      '<button class="btn sm" id="pyExp">⤓ تصدير</button></div>';

    h += '<div class="print-head"><h2>كشف التحصيل من ' + esc(AMB.fmtDay(from)) + ' إلى ' + esc(AMB.fmtDay(to)) + '</h2></div>';

    h += '<div class="grid g4" style="margin-bottom:16px">' +
      stat('متأخر على الأندية', fmoney(t.due), t.nDue + ' مباراة فاتت وما اتحصّلتش', t.due ? '#c1121f' : '#17864a') +
      stat('مع السواقين', fmoney(t.withDriver), t.nDriver ? t.nDriver + ' مباراة لسه ما وصلتش المكتب' : 'لا يوجد', t.withDriver ? '#a86300' : '#17864a') +
      stat('محصّل بالفعل', fmoney(t.collected), t.nIn + ' مباراة', '#17864a') +
      stat('مستحق لاحقاً', fmoney(t.upcoming), t.nUpcoming + ' مباراة — جاية أو مؤجلة لموعد لسه ما جاش', '#1d75d8') +
      '</div>';

    /* فلوس مع كل سائق */
    var byDriver = {};
    all.forEach(function (j) {
      if (payStatusOf(j) !== PAY.DRIVER) return;
      var k = j.payTo || '_';
      byDriver[k] = (byDriver[k] || 0) + paidAmount(j);
    });
    var dk = Object.keys(byDriver);
    if (dk.length) {
      h += '<div class="note warn"><strong>فلوس لسه مع الفريق:</strong> ' +
        dk.map(function (k) {
          return esc(k === '_' ? 'غير محدد' : M.staffName(k)) + ' — <strong>' + esc(fmoney(byDriver[k])) + '</strong>';
        }).join(' · ') + '</div>';
    }

    /* مؤجل ومتأخر عن موعده */
    var todayIso = AMB.today();
    var late = all.filter(function (j) {
      return payStatusOf(j) === PAY.LATER && j.payDue && j.payDue < todayIso;
    });
    if (late.length) {
      h += '<div class="note bad"><strong>' + late.length + ' مباراة عدّى موعد دفعها المتفق عليه</strong> — بإجمالي ' +
        esc(fmoney(late.reduce(function (a, j) { return a + (Number(j.fee) || 0); }, 0))) + '. كلّم الأندية دي.</div>';
    }

    /* الجدول */
    var rows = all.filter(function (j) {
      if (payVenue && j.venueId !== payVenue) return false;
      var st = payStatusOf(j);
      if (payFilter === 'all') return true;
      if (payFilter === 'due') return isDue(j);
      if (payFilter === 'upcoming') return !isDue(j) && dueAmount(j) > 0;
      return st === payFilter;
    }).sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); });

    h += '<div class="card"><div class="card-h"><h3>المباريات</h3><span class="spacer"></span>' +
      '<span class="tag">' + rows.length + ' مباراة · ' +
      esc(fmoney(rows.reduce(function (a, j) { return a + (Number(j.fee) || 0); }, 0))) + '</span></div>';

    if (!rows.length) {
      h += '<div class="card-b tight">' + UI.empty('₤',
        payFilter === 'due' ? 'مفيش فلوس متأخرة 🎉' : 'مفيش مباريات في الفلتر ده',
        payFilter === 'due' ? 'كل المباريات اللي فاتت اتحصّلت' : 'غيّر الفلتر أو الفترة') + '</div>';
    } else {
      h += '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
        '<th>اليوم</th><th>الوقت</th><th>النادي</th><th>المبلغ</th><th>حالة التحصيل</th><th>الطريقة</th><th>تاريخ الاستلام</th><th>الباقي</th><th class="no-print"></th>' +
        '</tr></thead><tbody>';
      rows.forEach(function (j) {
        var rem = dueAmount(j);
        var overdue = payStatusOf(j) === PAY.LATER && j.payDue && j.payDue < todayIso;
        h += '<tr' + (overdue ? ' style="background:var(--bad-bg)"' : '') + '>' +
          '<td class="nowrap">' + esc(AMB.fmtDayShort(j.date)) + '</td>' +
          '<td class="num nowrap">' + esc(AMB.fmtTime(j.time)) + '</td>' +
          '<td>' + esc(M.venueName(j.venueId)) + '</td>' +
          '<td class="num nowrap"><strong>' + esc(fmoney(j.fee)) + '</strong></td>' +
          '<td class="nowrap">' + payTag(j) + '</td>' +
          '<td class="small nowrap">' + esc(j.payMethod || '—') + (j.payRef ? '<div class="muted mono">' + esc(j.payRef) + '</div>' : '') + '</td>' +
          '<td class="small nowrap">' + (j.payDate ? esc(AMB.fmtDayShort(j.payDate)) : '<span class="muted">—</span>') + '</td>' +
          '<td class="num nowrap">' + (rem ? '<span style="color:var(--bad)">' + esc(fmoney(rem)) + '</span>' : '<span class="muted">—</span>') + '</td>' +
          '<td class="acts no-print">' +
            (payStatusOf(j) !== PAY.IN ? '<button class="btn sm ok" data-quick="' + j._id + '" title="تحصيل كامل فوراً">✓</button> ' : '') +
            '<button class="btn sm" data-pay="' + j._id + '">₤ تعديل</button>' +
          '</td>' +
        '</tr>';
      });
      h += '</tbody></table></div></div>';
    }

    /* ملخص كل نادي */
    var byVenue = {};
    all.forEach(function (j) {
      var k = j.venueId || '_';
      if (!byVenue[k]) byVenue[k] = { fee: 0, due: 0, n: 0 };
      byVenue[k].fee += Number(j.fee) || 0;
      byVenue[k].due += dueAmount(j);
      byVenue[k].n++;
    });
    var vk = Object.keys(byVenue).sort(function (a, b) { return byVenue[b].due - byVenue[a].due; });
    if (vk.length) {
      h += '<div class="card"><div class="card-h"><h3>ملخص كل نادي</h3></div>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
        '<th>النادي</th><th>مباريات</th><th>الإجمالي</th><th>المستحق</th><th>نسبة التحصيل</th></tr></thead><tbody>';
      vk.forEach(function (k) {
        var x = byVenue[k];
        var pct = x.fee ? Math.round((x.fee - x.due) / x.fee * 100) : 100;
        h += '<tr><td>' + esc(M.venueName(k)) + '</td>' +
          '<td class="num">' + x.n + '</td>' +
          '<td class="num nowrap">' + esc(fmoney(x.fee)) + '</td>' +
          '<td class="num nowrap">' + (x.due ? '<strong style="color:var(--bad)">' + esc(fmoney(x.due)) + '</strong>' : '<span class="muted">—</span>') + '</td>' +
          '<td><span class="tag ' + (pct >= 100 ? 'ok' : pct >= 50 ? 'warn' : 'bad') + '">' + pct + '%</span></td></tr>';
      });
      h += '</tbody></table></div></div>';
    }

    host.innerHTML = h;
    host.querySelector('#pyF').value = payFilter;

    host.querySelector('#pyFrom').onchange = function () { payFrom = this.value; render(); };
    host.querySelector('#pyTo').onchange = function () { payTo = this.value; render(); };
    host.querySelector('#pyF').onchange = function () { payFilter = this.value; render(); };
    host.querySelector('#pyV').onchange = function () { payVenue = this.value; render(); };
    host.querySelector('#pyPrint').onclick = function () { window.print(); };

    host.querySelectorAll('[data-pay]').forEach(function (b) {
      b.onclick = function () { collectPayment(b.dataset.pay); };
    });
    host.querySelectorAll('[data-quick]').forEach(function (b) {
      b.onclick = function () {
        var j = S.byId('assignments', b.dataset.quick);
        UI.confirm('تسجيل تحصيل ' + fmoney(j.fee) + ' من ' + M.venueName(j.venueId) + '؟', {
          title: 'تحصيل سريع', yes: 'نعم، اتحصّلت',
          detail: 'هتتسجّل «محصّل» كاش بتاريخ النهاردة. لو الطريقة مختلفة استخدم «₤ تعديل».'
        }).then(function (ok) {
          if (!ok) return;
          j.payStatus = PAY.IN; j.payMethod = 'كاش';
          j.payAmount = Number(j.fee) || 0; j.payDate = AMB.today();
          S.put('assignments', j);
          AMB.toast('تم التحصيل ✓', 'ok');
        });
      };
    });

    host.querySelector('#pyExp').onclick = function () {
      var out = [['التاريخ', 'الوقت', 'النادي', 'المبلغ', 'حالة التحصيل', 'الطريقة',
                  'المبلغ المستلم', 'تاريخ الاستلام', 'مع مين', 'رقم التحويل', 'موعد الدفع المؤجل', 'الباقي', 'ملاحظات']];
      rows.forEach(function (j) {
        out.push([j.date, j.time, M.venueName(j.venueId), Number(j.fee) || 0, payStatusOf(j),
          j.payMethod || '', paidAmount(j), j.payDate || '', j.payTo ? M.staffName(j.payTo) : '',
          j.payRef || '', j.payDue || '', dueAmount(j), j.payNotes || '']);
      });
      out.push([], ['الإجمالي', '', '', t.fee], ['محصّل', '', '', t.collected],
               ['مع السواقين', '', '', t.withDriver], ['مستحق', '', '', t.outstanding]);
      UI.downloadCSV('كشف-التحصيل-' + from + '_' + to + '.csv', out);
      AMB.toast('تم التصدير', 'ok');
    };
  }

  /* ============================================================
     4ج) مستحقات الفريق — تقرير أسبوعي ومحاسبة
     ============================================================ */

  var rollWeek = null;   // {from,to}

  function currentWeek() {
    var st = S.settings();
    if (!rollWeek) rollWeek = M.weekRange(AMB.today(), st.weekStart);
    return rollWeek;
  }

  function weekLabel(r) {
    var f = AMB.parseDay(r.from), t = AMB.parseDay(r.to);
    var same = f.getMonth() === t.getMonth();
    return f.getDate() + (same ? '' : ' ' + AMB.AR_MONTHS[f.getMonth()]) + ' – ' +
           t.getDate() + ' ' + AMB.AR_MONTHS[t.getMonth()] + ' ' + t.getFullYear();
  }

  function viewPayroll(host) {
    var st = S.settings();
    var w = currentWeek();
    var staff = S.all('staff').sort(byName);
    var isThisWeek = M.weekRange(AMB.today(), st.weekStart).from === w.from;

    var h = '<div class="filters no-print">' +
      '<button class="btn sm" id="wPrev">‹ الأسبوع السابق</button>' +
      '<strong style="min-width:190px;text-align:center">' + esc(weekLabel(w)) + '</strong>' +
      '<button class="btn sm" id="wNext">التالي ›</button>' +
      '<button class="btn sm" id="wNow">الأسبوع الحالي</button>' +
      '<span class="spacer"></span>' +
      '<label>يبدأ يوم</label><select id="wStart">' +
        AMB.AR_DAYS.map(function (d, i) {
          return '<option value="' + i + '"' + (Number(st.weekStart) === i ? ' selected' : '') + '>' + d + '</option>';
        }).join('') + '</select>' +
      '<button class="btn sm" id="wPrint">🖨 طباعة</button>' +
      '<button class="btn sm" id="wExp">⤓ تصدير</button></div>';

    h += '<div class="print-head"><h2>مستحقات الفريق — ' + esc(weekLabel(w)) + '</h2>' +
         '<p>' + esc(st.company) + '</p></div>';

    if (!staff.length) {
      host.innerHTML = h + '<div class="card"><div class="card-b tight">' +
        UI.empty('☺', 'مفيش أفراد مسجلين', 'ضيف السواقين والمسعفين الأول',
                 '<button class="btn pri" data-go="staff">شاشة الأفراد</button>') + '</div></div>';
      host.querySelectorAll('[data-go]').forEach(function (b) { b.onclick = function () { go(b.dataset.v || b.dataset.go); }; });
      return;
    }

    /* احسب لكل فرد */
    var rows = staff.map(function (s) {
      var sw = M.staffWeek(s._id, w.from, w.to);
      sw.staff = s;
      sw.payout = M.payoutFor(s._id, w.from, w.to);
      return sw;
    });
    var active = rows.filter(function (r) { return r.jobs > 0; });
    var noRate = active.filter(function (r) { return !r.rate; });

    var totalJobs = active.reduce(function (a, r) { return a + r.jobs; }, 0);
    var totalEarned = active.reduce(function (a, r) { return a + r.earned; }, 0);
    var totalBonus = active.reduce(function (a, r) { return a + r.autoBonus; }, 0);
    var totalPaid = active.reduce(function (a, r) { return a + (r.payout ? Number(r.payout.total) || 0 : 0); }, 0);
    var nPaid = active.filter(function (r) { return r.payout; }).length;
    var anyBonus = st.autoBonus && active.some(function (r) { return r.bonusRate > 0; });

    h += '<div class="grid g' + (anyBonus ? '5' : '4') + '" style="margin-bottom:16px">' +
      stat('أفراد اشتغلوا', active.length, 'من ' + staff.length + ' مسجلين', '#1d75d8') +
      stat('إجمالي المباريات', totalJobs, 'مجموع مشاركات الفريق', '#7b61ff') +
      stat('الأجور', fmoney(totalEarned), 'قبل البونص', '#a86300') +
      (anyBonus ? stat('🎁 البونص التلقائي', fmoney(totalBonus),
          active.reduce(function (a, r) { return a + r.bonusJobs; }, 0) + ' من ' + totalJobs + ' مباراة استحقت', '#17864a') : '') +
      stat('اتصرف', fmoney(totalPaid), nPaid + ' من ' + active.length + ' اتحاسبوا', nPaid === active.length && active.length ? '#17864a' : '#c1121f') +
      '</div>';

    if (anyBonus) {
      h += '<div class="note ok no-print">🎁 البونص التلقائي شغّال — <strong>' +
        esc(M.bonusRuleText(st.bonusRule)) + '</strong>. بينزل لوحده في حساب كل واحد، ' +
        'وتقدر تزوّد عليه بونص يدوي وقت الصرف. ' +
        '<button class="btn sm" data-go="settings" style="margin-top:6px">تعديل الإعداد</button></div>';
    }

    if (noRate.length) {
      h += '<div class="note warn no-print"><strong>' + noRate.length + ' فرد من غير أجر مباراة محدد</strong> (' +
        esc(noRate.map(function (r) { return r.staff.name; }).join('، ')) + ') — ' +
        'المستحق بتاعهم هيطلع صفر. حدد الأجر من بيانات كل واحد، أو حط أجر افتراضي للوظيفة من الإعدادات. ' +
        '<button class="btn sm" data-go="staff" style="margin-top:6px">شاشة الأفراد</button></div>';
    }

    if (!active.length) {
      h += '<div class="card"><div class="card-b tight">' +
        UI.empty('☰', 'مفيش مباريات للفريق في الأسبوع ده',
                 'جرّب أسبوع تاني، أو اتأكد إنك كلّفت الطاقم في المباريات') + '</div></div>';
    } else {
      h += '<div class="card"><div class="card-h"><h3>تفصيل الأسبوع</h3><span class="spacer"></span>' +
        '<span class="small muted no-print">اضغط على أي اسم عشان التقرير التفصيلي</span></div>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
        '<th>الفرد</th><th>الوظيفة</th><th>مباريات</th><th>حضور متحقق</th><th>تأخير</th>' +
        '<th>أجر المباراة</th><th>المستحق</th>' +
        (anyBonus ? '<th>🎁 بونص تلقائي</th>' : '') +
        '<th>يدوي</th><th>الصافي</th><th>الحالة</th><th class="no-print"></th>' +
        '</tr></thead><tbody>';

      active.forEach(function (r) {
        var p = r.payout;
        var adj = p ? (Number(p.bonus) || 0) - (Number(p.deduction) || 0) : 0;
        var net = p ? (Number(p.total) || 0) : (r.earned + r.autoBonus);
        h += '<tr>' +
          '<td><strong class="lnk" data-rep="' + r.staffId + '" style="cursor:pointer;color:var(--accent)">' + esc(r.staff.name) + '</strong></td>' +
          '<td class="small">' + esc(r.staff.role || '—') + '</td>' +
          '<td class="num"><strong>' + r.jobs + '</strong></td>' +
          '<td class="num nowrap">' + (r.countsAttendance
              ? r.verified + ' / ' + r.jobs +
                (r.missed ? ' <span class="tag bad">' + r.missed + ' بدون تسجيل</span>' : '')
              : '<span class="muted small">مش محسوب</span>') + '</td>' +
          '<td class="num">' + (r.countsAttendance
              ? (r.late ? '<span style="color:var(--bad)">' + r.late + '</span>' : '0')
              : '<span class="muted">—</span>') + '</td>' +
          '<td class="num nowrap">' + fmoney(r.rate) + '</td>' +
          '<td class="num nowrap">' + fmoney(r.earned) + '</td>' +
          (anyBonus ? '<td class="num nowrap">' + (r.autoBonus
              ? '<span style="color:var(--ok)">+' + fmoney(r.autoBonus) + '</span>' +
                '<div class="sub muted">' + r.bonusJobs + ' من ' + r.jobs + ' × ' + fmoney(r.bonusRate) + '</div>'
              : (r.bonusRate ? '<span class="muted">—</span><div class="sub muted">مستحقش</div>'
                             : '<span class="muted">مستثنى</span>')) + '</td>' : '') +
          '<td class="num nowrap">' + (adj ? (adj > 0 ? '<span style="color:var(--ok)">+' + fmoney(adj) + '</span>'
                                                      : '<span style="color:var(--bad)">' + fmoney(adj) + '</span>')
                                            : '<span class="muted">—</span>') + '</td>' +
          '<td class="num nowrap"><strong>' + fmoney(net) + '</strong></td>' +
          '<td class="nowrap">' + (p
              ? '<span class="tag ok dot">اتصرف ' + esc(AMB.fmtDayShort(p.paidDate)) + '</span>'
              : '<span class="tag bad">لسه</span>') + '</td>' +
          '<td class="acts no-print nowrap">' +
            '<button class="btn sm" data-rep="' + r.staffId + '">تقرير</button> ' +
            '<button class="btn sm ' + (p ? '' : 'ok') + '" data-settle="' + r.staffId + '">' +
              (p ? '✎' : '💵 صرف') + '</button>' +
          '</td>' +
        '</tr>';
      });

      h += '</tbody><tfoot><tr style="background:var(--panel2);font-weight:700">' +
        '<td colspan="2">الإجمالي</td>' +
        '<td class="num">' + totalJobs + '</td><td colspan="3"></td>' +
        '<td class="num nowrap">' + fmoney(totalEarned) + '</td>' +
        (anyBonus ? '<td class="num nowrap" style="color:var(--ok)">+' + fmoney(totalBonus) + '</td>' : '') +
        '<td></td>' +
        '<td class="num nowrap">' + fmoney(active.reduce(function (a, r) {
          return a + (r.payout ? Number(r.payout.total) || 0 : r.earned + r.autoBonus); }, 0)) + '</td>' +
        '<td colspan="2"></td></tr></tfoot></table></div></div>';

      /* أزرار جماعية */
      var unpaid = active.filter(function (r) { return !r.payout && (r.earned + r.autoBonus) > 0; });
      if (unpaid.length) {
        h += '<div class="note no-print" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
          '<span style="flex:1"><strong>' + unpaid.length + ' فرد</strong> لسه ما اتحاسبوش الأسبوع ده — بإجمالي ' +
          fmoney(unpaid.reduce(function (a, r) { return a + r.earned + r.autoBonus; }, 0)) + '</span>' +
          '<button class="btn pri sm" id="settleAll">💵 صرف للكل</button></div>';
      }
    }

    host.innerHTML = h;

    host.querySelector('#wPrev').onclick = function () { rollWeek = M.shiftWeek(w, -1, st.weekStart); render(); };
    host.querySelector('#wNext').onclick = function () { rollWeek = M.shiftWeek(w, 1, st.weekStart); render(); };
    host.querySelector('#wNow').onclick = function () { rollWeek = M.weekRange(AMB.today(), st.weekStart); render(); };
    host.querySelector('#wStart').onchange = function () {
      st.weekStart = Number(this.value); S.saveSettings(st);
      rollWeek = M.weekRange(AMB.today(), st.weekStart); render();
    };
    host.querySelector('#wPrint').onclick = function () { window.print(); };
    host.querySelectorAll('[data-go]').forEach(function (b) { b.onclick = function () { go(b.dataset.go); }; });
    host.querySelectorAll('[data-rep]').forEach(function (b) {
      b.onclick = function () { staffWeekReport(b.dataset.rep, w); };
    });
    host.querySelectorAll('[data-settle]').forEach(function (b) {
      b.onclick = function () { settlePayout(b.dataset.settle, w); };
    });

    var sa = host.querySelector('#settleAll');
    if (sa) sa.onclick = function () { settleAll(w); };

    host.querySelector('#wExp').onclick = function () {
      var out = [['مستحقات الفريق', weekLabel(w)], [],
        ['الفرد', 'الوظيفة', 'مباريات', 'حضور متحقق', 'غياب', 'تأخير', 'أجر المباراة',
         'الأجور', 'مباريات استحقت بونص', 'بونص المباراة', 'البونص التلقائي',
         'بونص يدوي', 'خصم', 'الصافي', 'الحالة', 'تاريخ الصرف', 'طريقة الصرف', 'ملاحظات']];
      active.forEach(function (r) {
        var p = r.payout;
        out.push([r.staff.name, r.staff.role || '', r.jobs,
          r.countsAttendance ? r.verified : '', r.countsAttendance ? r.missed : '',
          r.countsAttendance ? r.late : '', r.rate, r.earned,
          r.bonusRate ? r.bonusJobs : '', r.bonusRate || '', r.autoBonus || '',
          p ? (p.bonus || 0) : '', p ? (p.deduction || 0) : '',
          p ? p.total : (r.earned + r.autoBonus), p ? 'اتصرف' : 'لسه',
          p ? p.paidDate : '', p ? (p.method || '') : '', p ? (p.notes || '') : '']);
      });
      out.push([], ['الإجمالي', '', totalJobs, '', '', '', '', totalEarned, '', '', totalBonus, '', '',
                    active.reduce(function (a, r) { return a + (r.payout ? Number(r.payout.total) || 0 : r.earned + r.autoBonus); }, 0)]);
      if (anyBonus) out.push([], ['شرط البونص التلقائي', M.bonusRuleText(st.bonusRule)]);
      UI.downloadCSV('مستحقات-الفريق-' + w.from + '.csv', out);
      AMB.toast('تم التصدير', 'ok');
    };
  }

  /* ---------- تقرير الفرد الأسبوعي ---------- */

  function staffWeekReport(staffId, w) {
    var s = S.byId('staff', staffId);
    if (!s) return;
    var st = S.settings();
    var sw = M.staffWeek(staffId, w.from, w.to);
    var p = M.payoutFor(staffId, w.from, w.to);
    var adj = p ? (Number(p.bonus) || 0) - (Number(p.deduction) || 0) : 0;
    var net = p ? Number(p.total) || 0 : (sw.earned + sw.autoBonus);
    var showBonus = sw.bonusRate > 0;

    var h = '<div class="print-head"><h2>' + esc(st.company) + '</h2>' +
            '<p>تقرير أسبوعي — ' + esc(weekLabel(w)) + '</p></div>';

    h += '<div class="row" style="margin-bottom:14px">' +
      '<div><div class="small muted">الاسم</div><strong style="font-size:1.05rem">' + esc(s.name) + '</strong></div>' +
      '<div><div class="small muted">الوظيفة</div><strong>' + esc(s.role || '—') + '</strong></div>' +
      '<div><div class="small muted">الموبايل</div><strong class="mono">' + esc(s.phone || '—') + '</strong></div>' +
      '<div><div class="small muted">الأسبوع</div><strong>' + esc(weekLabel(w)) + '</strong></div>' +
      '</div>';

    h += '<div class="grid g4" style="margin-bottom:14px">' +
      stat('المباريات', sw.jobs, 'خلال الأسبوع', '#1d75d8') +
      (sw.countsAttendance
        ? stat('حضور متحقق', sw.verified + ' / ' + sw.jobs, sw.missed ? sw.missed + ' من غير تسجيل' : 'كامل', sw.missed ? '#c1121f' : '#17864a')
        : stat('نوع التسجيل', 'حركة سيارة', 'سائق — مش داخل تقييم الحضور', '#8b97a8')) +
      (sw.countsAttendance
        ? stat('مرات التأخير', sw.late, sw.late ? 'بمتوسط ' + AMB.fmtMins(sw.avgLate) : 'ملتزم', sw.late ? '#a86300' : '#17864a')
        : stat('—', '—', '', '#8b97a8')) +
      stat('الصافي المستحق', fmoney(net),
           sw.jobs + ' × ' + fmoney(sw.rate) + (sw.autoBonus ? ' + 🎁 ' + fmoney(sw.autoBonus) : ''), '#17864a') +
      '</div>';

    if (!sw.jobs) {
      h += '<div class="note">مفيش مباريات للفرد ده في الأسبوع ده.</div>';
    } else {
      h += '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
        '<th>اليوم</th><th>الملعب</th><th>الموعد</th><th>السيارة</th>' +
        (sw.countsAttendance ? '<th>وصل الساعة</th><th>الالتزام</th>' : '<th>سجّل خروج</th>') +
        '<th>الأجر</th>' + (showBonus ? '<th>🎁 بونص</th>' : '') + '</tr></thead><tbody>';
      sw.rows.forEach(function (r) {
        var j = r.job;
        h += '<tr>' +
          '<td class="nowrap">' + esc(AMB.fmtDayShort(j.date)) + '</td>' +
          '<td>' + esc(M.venueName(j.venueId)) + '</td>' +
          '<td class="num nowrap">' + esc(AMB.fmtTime(j.time)) + '</td>' +
          '<td class="small nowrap">' + esc(M.vehicleName(j.vehicleId)) + '</td>';
        if (sw.countsAttendance) {
          h += '<td class="num nowrap">' + (r.arrive ? esc(AMB.fmtClock(r.arrive.ts)) : '<span class="tag bad">ما سجّلش</span>') + '</td>' +
            '<td class="nowrap">' + (!r.arrive ? '<span class="muted">—</span>'
              : r.lateBy == null ? '<span class="muted">—</span>'
              : r.lateBy === 0 ? '<span class="tag ok">في الميعاد بالظبط</span>'
              : r.lateBy < 0 ? '<span class="tag ok">قبل الموعد بـ ' + esc(AMB.fmtMins(-r.lateBy)) + '</span>'
              : r.lateBy <= (st.lateGraceMin || 15) ? '<span class="tag warn">+' + esc(AMB.fmtMins(r.lateBy)) + '</span>'
              : '<span class="tag bad">متأخر ' + esc(AMB.fmtMins(r.lateBy)) + '</span>') +
            (r.arrive && r.arrive.valid === false ? ' <span class="tag bad">خارج النطاق</span>' : '') + '</td>';
        } else {
          h += '<td class="nowrap">' + (r.depart ? esc(AMB.fmtClock(r.depart.ts)) : '<span class="muted">—</span>') + '</td>';
        }
        h += '<td class="num nowrap">' + fmoney(sw.rate) + '</td>';
        if (showBonus) {
          h += '<td class="num nowrap">' + (r.earnsBonus
            ? '<span style="color:var(--ok)">+' + fmoney(sw.bonusRate) + '</span>'
            : '<span class="muted">—</span>' +
              (r.whyNoBonus ? '<div class="sub muted">' + esc(r.whyNoBonus) + '</div>' : '')) + '</td>';
        }
        h += '</tr>';
      });
      h += '</tbody><tfoot><tr style="background:var(--panel2);font-weight:700">' +
        '<td colspan="' + (sw.countsAttendance ? 5 : 4) + '">إجمالي ' + sw.jobs + ' مباراة</td>' +
        '<td class="num nowrap">' + fmoney(sw.earned) + '</td>' +
        (showBonus ? '<td class="num nowrap" style="color:var(--ok)">' +
          (sw.autoBonus ? '+' + fmoney(sw.autoBonus) : '—') + '</td>' : '') +
        '</tr></tfoot></table></div>';
    }

    /* خلاصة المحاسبة */
    h += '<div class="card" style="margin-top:14px"><div class="card-h"><h3>خلاصة المحاسبة</h3></div><div class="card-b">' +
      '<div class="kv"><span class="k">' + sw.jobs + ' مباراة × ' + fmoney(sw.rate) + '</span><span class="v">' + fmoney(sw.earned) + '</span></div>' +
      (sw.autoBonus ? '<div class="kv"><span class="k">🎁 بونص تلقائي — ' + sw.bonusJobs + ' مباراة × ' + fmoney(sw.bonusRate) +
        '<div class="small muted">' + esc(M.bonusRuleText(sw.bonusRule)) + '</div></span>' +
        '<span class="v" style="color:var(--ok)">+ ' + fmoney(sw.autoBonus) + '</span></div>' : '') +
      (p && Number(p.bonus) ? '<div class="kv"><span class="k">بونص إضافي' + (p.bonusReason ? ' — ' + esc(p.bonusReason) : '') + '</span>' +
        '<span class="v" style="color:var(--ok)">+ ' + fmoney(p.bonus) + '</span></div>' : '') +
      (p && Number(p.deduction) ? '<div class="kv"><span class="k">خصم' + (p.deductionReason ? ' — ' + esc(p.deductionReason) : '') + '</span>' +
        '<span class="v" style="color:var(--bad)">− ' + fmoney(p.deduction) + '</span></div>' : '') +
      '<div class="kv" style="border-top:2px solid var(--line);padding-top:8px;margin-top:4px">' +
        '<span class="k" style="font-weight:700;color:var(--ink)">الصافي المستحق</span>' +
        '<span class="v" style="font-size:1.15rem">' + fmoney(net) + '</span></div>' +
      (p ? '<div class="note ok" style="margin:12px 0 0">✓ اتصرف يوم ' + esc(AMB.fmtDay(p.paidDate)) +
           (p.method ? ' — ' + esc(p.method) : '') + (p.notes ? '<br><span class="small">' + esc(p.notes) + '</span>' : '') + '</div>'
         : '<div class="note warn" style="margin:12px 0 0">لسه ما اتصرفش.</div>') +
      '<div style="margin-top:26px;display:flex;gap:40px;flex-wrap:wrap" class="print-only">' +
        '<div style="flex:1;min-width:150px;border-top:1px solid var(--ink3);padding-top:6px;text-align:center" class="small">توقيع المستلم</div>' +
        '<div style="flex:1;min-width:150px;border-top:1px solid var(--ink3);padding-top:6px;text-align:center" class="small">توقيع الإدارة</div>' +
      '</div>' +
    '</div></div>';

    UI.modal({
      title: '☰ تقرير ' + s.name, size: 'wide', body: h,
      buttons: [
        { text: '🖨 طباعة', cls: 'acc', keepOpen: true, onClick: function () { window.print(); return false; } },
        { text: p ? '✎ تعديل الصرف' : '💵 صرف', cls: p ? '' : 'ok',
          onClick: function () { setTimeout(function () { settlePayout(staffId, w); }, 130); } },
        { spacer: true }, { text: 'إغلاق' }
      ]
    });
  }

  /* ---------- تسجيل الصرف ---------- */

  function settlePayout(staffId, w, after) {
    var s = S.byId('staff', staffId);
    var sw = M.staffWeek(staffId, w.from, w.to);
    var p = M.payoutFor(staffId, w.from, w.to);
    var ids = {};
    function F(o) { ids[o.key] = { id: AMB.uid('f'), type: o.type }; o.id = ids[o.key].id; return UI.field(o); }

    var body =
      '<div class="row" style="margin-bottom:8px">' +
        '<div><div class="small muted">الفرد</div><strong>' + esc(s.name) + '</strong></div>' +
        '<div><div class="small muted">الأسبوع</div><strong>' + esc(weekLabel(w)) + '</strong></div>' +
        '<div><div class="small muted">المباريات</div><strong>' + sw.jobs + ' × ' + fmoney(sw.rate) + '</strong></div>' +
        '<div><div class="small muted">المستحق الأساسي</div><strong>' + fmoney(sw.earned) + '</strong></div>' +
      '</div>' +
      (sw.bonusRate > 0
        ? '<div class="note ' + (sw.autoBonus ? 'ok' : 'warn') + '">🎁 <strong>البونص التلقائي:</strong> ' +
          (sw.autoBonus
            ? '<strong>' + fmoney(sw.autoBonus) + '</strong> — ' + sw.bonusJobs + ' مباراة استحقت × ' + fmoney(sw.bonusRate) +
              (sw.bonusJobs < sw.jobs ? ' <span class="small">(' + (sw.jobs - sw.bonusJobs) + ' مباراة ما استحقتش)</span>' : '')
            : 'مفيش — ولا مباراة استحقت البونص الأسبوع ده') +
          '<div class="small muted" style="margin-top:3px">الشرط: ' + esc(M.bonusRuleText(sw.bonusRule)) + '</div></div>'
        : '') +
      (sw.countsAttendance && (sw.missed || sw.late)
        ? '<div class="note warn">للعلم قبل ما تحاسبه: ' +
          (sw.missed ? '<strong>' + sw.missed + '</strong> مباراة ما سجّلش فيها حضور. ' : '') +
          (sw.late ? 'اتأخر <strong>' + sw.late + '</strong> مرة بمتوسط ' + esc(AMB.fmtMins(sw.avgLate)) + '.' : '') +
          '</div>' : '') +
      '<div class="row">' +
        F({ key: 'bonus', label: 'بونص يدوي إضافي (ج)', type: 'number', value: p ? p.bonus : '', min: 0,
            hint: sw.bonusRate ? 'فوق البونص التلقائي' : '' }) +
        F({ key: 'bonusReason', label: 'سبب البونص اليدوي', value: p ? p.bonusReason : '', placeholder: 'مجهود إضافي' }) +
      '</div>' +
      '<div class="row">' +
        F({ key: 'deduction', label: 'خصم (ج)', type: 'number', value: p ? p.deduction : '', min: 0 }) +
        F({ key: 'deductionReason', label: 'سبب الخصم', value: p ? p.deductionReason : '', placeholder: 'تأخير / غياب' }) +
      '</div>' +
      '<div class="note" id="_calc"></div>' +
      '<div class="row">' +
        F({ key: 'paidDate', label: 'تاريخ الصرف', type: 'date', value: p ? p.paidDate : AMB.today() }) +
        F({ key: 'method', label: 'طريقة الصرف', type: 'select', value: p ? p.method : 'كاش',
            options: ['كاش', 'تحويل بنكي', 'انستاباي / محفظة', 'شيك'] }) +
      '</div>' +
      F({ key: 'notes', label: 'ملاحظات', value: p ? p.notes : '' });

    var btns = [{ text: p ? 'حفظ التعديل' : '💵 تسجيل الصرف', cls: 'pri', keepOpen: true, onClick: function (api) {
      var d = UI.readForm(api.body, ids);
      var bonus = Number(d.bonus) || 0, ded = Number(d.deduction) || 0;
      var rec = p ? Object.assign({}, p) : {};
      Object.assign(rec, {
        staffId: staffId, from: w.from, to: w.to,
        jobs: sw.jobs, rate: sw.rate, earned: sw.earned,
        autoBonus: sw.autoBonus, bonusJobs: sw.bonusJobs, bonusRate: sw.bonusRate,
        bonus: bonus, bonusReason: d.bonusReason,
        deduction: ded, deductionReason: d.deductionReason,
        total: sw.earned + sw.autoBonus + bonus - ded,
        paidDate: d.paidDate || AMB.today(), method: d.method, notes: d.notes
      });
      S.put('payouts', rec);
      api.close();
      AMB.toast('تم تسجيل صرف ' + money(rec.total) + ' لـ ' + s.name, 'ok');
      if (after) after();
      return true;
    } }];
    if (p) btns.push({ text: 'إلغاء الصرف', cls: 'danger', keepOpen: true, onClick: function (api) {
      UI.confirm('إلغاء تسجيل الصرف؟', { danger: true, detail: 'الأسبوع هيرجع «لسه ما اتصرفش».' })
        .then(function (ok) { if (ok) { S.remove('payouts', p._id); api.close(); AMB.toast('تم الإلغاء'); if (after) after(); } });
      return false;
    } });
    btns.push({ spacer: true }, { text: 'إغلاق' });

    var m = UI.modal({ title: '💵 محاسبة ' + s.name, body: body, buttons: btns });

    function calc() {
      var b = Number(m.body.querySelector('#' + ids.bonus.id).value) || 0;
      var d2 = Number(m.body.querySelector('#' + ids.deduction.id).value) || 0;
      m.body.querySelector('#_calc').innerHTML =
        fmoney(sw.earned) +
        (sw.autoBonus ? ' + <span style="color:var(--ok)">' + fmoney(sw.autoBonus) + ' 🎁</span>' : '') +
        (b ? ' + ' + fmoney(b) : '') + (d2 ? ' − ' + fmoney(d2) : '') +
        ' = <strong style="font-size:1.1rem">' + fmoney(sw.earned + sw.autoBonus + b - d2) + '</strong>';
    }
    m.body.querySelector('#' + ids.bonus.id).addEventListener('input', calc);
    m.body.querySelector('#' + ids.deduction.id).addEventListener('input', calc);
    calc();
  }

  function settleAll(w) {
    var staff = S.all('staff');
    var pending = staff.map(function (s) {
      var sw = M.staffWeek(s._id, w.from, w.to);
      return { s: s, sw: sw, p: M.payoutFor(s._id, w.from, w.to) };
    }).filter(function (x) { return x.sw.jobs > 0 && !x.p && (x.sw.earned + x.sw.autoBonus) > 0; });

    if (!pending.length) { AMB.toast('مفيش حد مستني الصرف', 'warn'); return; }
    var total = pending.reduce(function (a, x) { return a + x.sw.earned + x.sw.autoBonus; }, 0);
    var bonusTotal = pending.reduce(function (a, x) { return a + x.sw.autoBonus; }, 0);

    UI.confirm('تسجيل صرف لـ ' + pending.length + ' فرد بإجمالي ' + money(total) + '؟', {
      title: '💵 صرف جماعي', yes: 'أيوه، سجّل الصرف',
      detail: (bonusTotal ? 'شامل ' + money(bonusTotal) + ' بونص تلقائي. ' : '') +
              'من غير بونص يدوي ولا خصم، بتاريخ النهاردة كاش. تقدر تعدّل أي واحد بعد كده.'
    }).then(function (ok) {
      if (!ok) return;
      var recs = pending.map(function (x) {
        return {
          staffId: x.s._id, from: w.from, to: w.to,
          jobs: x.sw.jobs, rate: x.sw.rate, earned: x.sw.earned,
          autoBonus: x.sw.autoBonus, bonusJobs: x.sw.bonusJobs, bonusRate: x.sw.bonusRate,
          bonus: 0, deduction: 0, total: x.sw.earned + x.sw.autoBonus,
          paidDate: AMB.today(), method: 'كاش', notes: 'صرف جماعي'
        };
      });
      S.putBatch('payouts', recs);
      AMB.toast('تم تسجيل صرف ' + recs.length + ' فرد', 'ok');
    });
  }

  /* ============================================================
     5) السيارات
     ============================================================ */

  function viewFleet(host) {
    var vehicles = S.all('vehicles');
    var h = '<div class="filters no-print"><span class="spacer"></span>' +
            '<button class="btn pri sm" id="addVeh">+ سيارة جديدة</button></div>';

    if (!vehicles.length) {
      h += '<div class="card"><div class="card-b tight">' + UI.empty('▣', 'مفيش سيارات مسجلة', '', '<button class="btn pri" id="addVeh2">أضف أول سيارة</button>') + '</div></div>';
    } else {
      h += '<div class="grid g3">';
      vehicles.forEach(function (v) {
        var odo = M.odometer(v._id);
        var cons = M.consumption(v._id);
        var p = M.lastPing(v._id);
        var due = M.dueMaintenance().filter(function (d) { return d.vehicleId === v._id; });
        var lastFuel = S.all('fuel').filter(function (f) { return f.vehicleId === v._id; })
                        .sort(function (a, b) { return b.date.localeCompare(a.date); })[0];
        var openNotes = S.all('incidents').filter(function (r) {
          return isNote(r) && r.vehicleId === v._id && r.status !== 'تم الحل';
        }).length;

        h += '<div class="card" style="margin:0"><div class="card-h" style="border-inline-start:5px solid ' + esc(v.color || '#888') + '">' +
          '<h3>' + esc(v.name) + '</h3><span class="spacer"></span>' + vehTag(v.status) + '</div><div class="card-b">' +
          '<div class="kv"><span class="k">رقم اللوحة</span><span class="v mono">' + esc(v.plate || '—') + '</span></div>' +
          '<div class="kv"><span class="k">الموديل</span><span class="v">' + esc([v.model, v.year].filter(Boolean).join(' ') || '—') + '</span></div>' +
          '<div class="kv"><span class="k">العداد</span><span class="v mono">' + (odo ? num(odo, 0) + ' كم' : '—') + '</span></div>' +
          '<div class="kv"><span class="k">الاستهلاك</span><span class="v">' + (cons ? num(cons.kmPerLiter, 1) + ' كم/لتر' : '<span class="muted small">محتاج تعبئتين على الأقل</span>') + '</span></div>' +
          '<div class="kv"><span class="k">آخر تفويل</span><span class="v">' + (lastFuel ? esc(AMB.fmtDayShort(lastFuel.date)) + ' · ' + esc(fmoney(lastFuel.total)) : '—') + '</span></div>' +
          '<div class="kv"><span class="k">آخر إشارة</span><span class="v">' + (p ? esc(AMB.ago(p.ts)) : '<span class="muted">لا يوجد</span>') + '</span></div>' +
          (due.length ? '<div class="note ' + (due.some(function (d) { return d.overdue; }) ? 'bad' : 'warn') + '" style="margin:10px 0 0">⚙ ' + due.length + ' صيانة مستحقة</div>' : '') +
          (openNotes ? '<div class="note" style="margin:10px 0 0">📝 ' + openNotes + ' ملاحظة مفتوحة</div>' : '') +
          '<div class="btn-row" style="margin-top:12px">' +
            '<button class="btn sm" data-veh="' + v._id + '">✎ تعديل</button>' +
            '<button class="btn sm" data-vfuel="' + v._id + '">⛽ تفويل</button>' +
            '<button class="btn sm" data-vmaint="' + v._id + '">⚙ صيانة</button>' +
            '<button class="btn sm' + (openNotes ? ' acc' : '') + '" data-vnotes="' + v._id + '">📝 ملاحظات' +
              (openNotes ? ' (' + openNotes + ')' : '') + '</button>' +
          '</div></div></div>';
      });
      h += '</div>';
    }

    host.innerHTML = h;
    var add = function () { editVehicle(null); };
    host.querySelector('#addVeh').onclick = add;
    var a2 = host.querySelector('#addVeh2'); if (a2) a2.onclick = add;
    host.querySelectorAll('[data-veh]').forEach(function (b) { b.onclick = function () { editVehicle(b.dataset.veh); }; });
    host.querySelectorAll('[data-vfuel]').forEach(function (b) { b.onclick = function () { editFuel(null, b.dataset.vfuel); }; });
    host.querySelectorAll('[data-vmaint]').forEach(function (b) { b.onclick = function () { editMaint(null, b.dataset.vmaint); }; });
    host.querySelectorAll('[data-vnotes]').forEach(function (b) { b.onclick = function () { vehicleNotes(b.dataset.vnotes); }; });
  }

  /* ---------- ملاحظات السيارة ---------- */

  function vehicleNotes(vehicleId) {
    var v = S.byId('vehicles', vehicleId);
    if (!v) return;

    function draw(m) {
      var notes = S.all('incidents')
        .filter(function (r) { return isNote(r) && r.vehicleId === vehicleId; })
        .sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
      var open = notes.filter(function (r) { return r.status !== 'تم الحل'; });

      var h = '<div class="btn-row" style="margin-bottom:12px">' +
        '<button class="btn acc" id="_add">+ ملاحظة جديدة</button>' +
        '<span style="flex:1"></span>' +
        '<span class="tag' + (open.length ? ' warn' : ' ok') + '">' +
        (open.length ? open.length + ' مفتوحة' : 'مفيش ملاحظات مفتوحة') + '</span></div>';

      if (!notes.length) {
        h += UI.empty('📝', 'مفيش ملاحظات على ' + v.name,
          'السواقين والمسعفين بيقدروا يسجلوا ملاحظات من موبايلهم، وتقدر إنت كمان تضيف من هنا');
      } else {
        h += '<ul class="list" style="border:1px solid var(--line);border-radius:9px;max-height:400px;overflow-y:auto">';
        notes.forEach(function (r) {
          var done = r.status === 'تم الحل';
          h += '<li' + (done ? ' style="opacity:.55"' : '') + '>' +
            '<div style="flex:1;min-width:0">' +
              '<div class="ttl">' + (done ? '✓ ' : '') + esc(r.type || 'ملاحظة') + '</div>' +
              '<div class="sub" style="white-space:pre-wrap">' + esc(r.description) + '</div>' +
              '<div class="sub muted">' + esc(M.staffName(r.staffId)) + ' · ' + esc(AMB.fmtStamp(r.ts)) + '</div>' +
            '</div>' +
            (done ? '<span class="tag ok">تم</span>'
                  : '<button class="btn sm ok" data-ndone="' + r._id + '">✓ تم</button>') +
            ' <button class="btn sm danger" data-ndel="' + r._id + '" title="حذف">🗑</button>' +
          '</li>';
        });
        h += '</ul>';
      }

      m.body.innerHTML = h;

      m.body.querySelector('#_add').onclick = function () { addNote(vehicleId, function () { draw(m); }); };
      m.body.querySelectorAll('[data-ndone]').forEach(function (b) {
        b.onclick = function () {
          var r = S.byId('incidents', b.dataset.ndone);
          r.status = 'تم الحل'; r.resolvedAt = Date.now();
          S.put('incidents', r); draw(m);
        };
      });
      m.body.querySelectorAll('[data-ndel]').forEach(function (b) {
        b.onclick = function () {
          UI.confirm('حذف الملاحظة نهائياً؟', { danger: true }).then(function (ok) {
            if (ok) { S.remove('incidents', b.dataset.ndel); draw(m); }
          });
        };
      });
    }

    var m = UI.modal({
      title: '📝 ملاحظات ' + v.name, size: 'wide', body: '',
      buttons: [{ spacer: true }, { text: 'إغلاق' }]
    });
    draw(m);
  }

  function addNote(vehicleId, after) {
    var vehicles = S.all('vehicles');
    var staff = S.all('staff').sort(byName);
    var ids = {};
    function F(o) { ids[o.key] = { id: AMB.uid('f'), type: o.type }; o.id = ids[o.key].id; return UI.field(o); }

    var body =
      '<div class="row">' +
        F({ key: 'vehicleId', label: 'السيارة', type: 'select', value: vehicleId,
            options: vehicles.map(function (v) { return { value: v._id, text: v.name }; }) }) +
        F({ key: 'type', label: 'نوع الملاحظة', type: 'select', options: NOTE_TYPES }) +
      '</div>' +
      F({ key: 'staffId', label: 'مين لاحظها', type: 'select',
          options: [{ value: '', text: '— أنا (المدير) —' }].concat(staff.map(function (s) {
            return { value: s._id, text: s.name + (s.role ? ' — ' + s.role : '') }; })) }) +
      F({ key: 'description', label: 'الملاحظة', type: 'textarea', rows: 3, req: true,
          placeholder: 'مثلاً: ناقص شنطة إسعافات أولية / الكرسي المتحرك عجلته مكسورة' });

    UI.modal({
      title: '📝 ملاحظة جديدة', size: 'narrow', body: body,
      buttons: [{ text: 'حفظ الملاحظة', cls: 'pri', keepOpen: true, onClick: function (api) {
        var d = UI.readForm(api.body, ids);
        if (!d.description) { AMB.toast('اكتب الملاحظة', 'error'); return false; }
        S.put('incidents', {
          kind: 'ملاحظة', vehicleId: d.vehicleId, type: d.type,
          severity: 'ملاحظة', description: d.description,
          staffId: d.staffId, ts: Date.now(), status: 'جديد', lat: null, lng: null
        });
        api.close(); AMB.toast('تم حفظ الملاحظة', 'ok');
        if (after) after();
        return true;
      } }, { text: 'إلغاء' }]
    });
  }

  function editVehicle(id) {
    var rec = id ? Object.assign({}, S.byId('vehicles', id)) :
      { name: '', plate: '', model: '', year: '', color: PALETTE[S.all('vehicles').length % PALETTE.length],
        status: 'متاح', odometer: 0, fuelType: 'سولار', tankSize: 70, notes: '' };

    var ids = {};
    function F(o) { ids[o.key] = { id: AMB.uid('f'), type: o.type }; o.id = ids[o.key].id; return UI.field(o); }

    var body =
      '<div class="row">' +
        F({ key: 'name', label: 'اسم السيارة', value: rec.name, req: true, placeholder: 'إسعاف 1' }) +
        F({ key: 'plate', label: 'رقم اللوحة', value: rec.plate, placeholder: 'س ن ع ١٢٣' }) +
      '</div>' +
      '<div class="row">' +
        F({ key: 'model', label: 'الموديل', value: rec.model, placeholder: 'تويوتا هايس' }) +
        F({ key: 'year', label: 'سنة الصنع', value: rec.year, placeholder: '2019' }) +
        F({ key: 'status', label: 'الحالة', type: 'select', value: rec.status, options: VEH_STATUS }) +
      '</div>' +
      '<div class="row">' +
        F({ key: 'odometer', label: 'قراءة العداد الحالية (كم)', type: 'number', value: rec.odometer, min: 0,
            hint: 'مهمة عشان تنبيهات الصيانة وحساب الاستهلاك تطلع صح' }) +
        F({ key: 'fuelType', label: 'نوع الوقود', type: 'select', value: rec.fuelType, options: FUEL_TYPES }) +
        F({ key: 'tankSize', label: 'سعة التانك (لتر)', type: 'number', value: rec.tankSize, min: 0 }) +
      '</div>' +
      '<div class="field"><label>لون التمييز على الخريطة</label><div class="checks" id="_col">' +
        PALETTE.map(function (c) {
          return '<label class="chk' + (c === rec.color ? ' on' : '') + '" data-c="' + c + '" style="gap:5px">' +
            '<span class="swatch" style="width:16px;height:16px;background:' + c + '"></span></label>';
        }).join('') + '</div></div>' +
      F({ key: 'notes', label: 'ملاحظات', type: 'textarea', value: rec.notes, rows: 2 });

    var btns = [{ text: id ? 'حفظ' : 'إضافة', cls: 'pri', keepOpen: true, onClick: function (api) {
      var d = UI.readForm(api.body, ids);
      if (!d.name) { AMB.toast('اسم السيارة مطلوب', 'error'); return false; }
      d.color = api.body.querySelector('#_col .chk.on') ? api.body.querySelector('#_col .chk.on').dataset.c : rec.color;
      Object.assign(rec, d);
      S.put('vehicles', rec); api.close(); AMB.toast('تم الحفظ', 'ok'); return true;
    } }];
    if (id) btns.push({ text: 'حذف', cls: 'danger', keepOpen: true, onClick: function (api) {
      UI.confirm('حذف ' + rec.name + '؟', { danger: true, detail: 'المهام المرتبطة بيها هتفضل موجودة لكن من غير سيارة.' })
        .then(function (ok) { if (ok) { S.remove('vehicles', id); api.close(); AMB.toast('تم الحذف'); } });
      return false;
    } });
    btns.push({ spacer: true }, { text: 'إغلاق' });

    var m = UI.modal({ title: id ? 'تعديل سيارة' : 'سيارة جديدة', body: body, buttons: btns });
    m.body.querySelectorAll('#_col .chk').forEach(function (l) {
      l.onclick = function (e) {
        e.preventDefault();
        m.body.querySelectorAll('#_col .chk').forEach(function (x) { x.classList.remove('on'); });
        l.classList.add('on');
      };
    });
  }

  /* ============================================================
     6) الصيانة
     ============================================================ */

  function viewMaint(host) {
    var due = M.dueMaintenance();
    var recs = S.all('maintenance').sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });

    var h = '<div class="filters no-print">' +
      '<label>السيارة</label><select id="mfVeh"><option value="">الكل</option>' +
      S.all('vehicles').map(function (v) { return '<option value="' + v._id + '"' + (maintVeh === v._id ? ' selected' : '') + '>' + esc(v.name) + '</option>'; }).join('') + '</select>' +
      '<span class="spacer"></span><button class="btn sm" id="mfExp">⤓ تصدير</button>' +
      '<button class="btn pri sm" id="addMaint">+ سجل صيانة</button></div>';

    /* بلاغات السواقين المفتوحة — الملاحظات ليها مكانها في شاشة السيارات */
    var openIssues = S.all('incidents')
      .filter(function (r) { return isFault(r) && r.status !== 'تم الحل' && (!maintVeh || r.vehicleId === maintVeh); })
      .sort(function (a, b) {
        var rank = { 'عاجل': 0, 'مهم': 1, 'عادي': 2 };
        /* لازم !== undefined — لأن رتبة «عاجل» صفر، و`|| 3` كانت بتحوّلها لأدنى أولوية */
        var ra = rank[a.severity] !== undefined ? rank[a.severity] : 3;
        var rb = rank[b.severity] !== undefined ? rank[b.severity] : 3;
        return ra !== rb ? ra - rb : b.ts - a.ts;
      });

    if (openIssues.length) {
      h += '<div class="card"><div class="card-h" style="background:var(--bad-bg)"><h3>⚠ بلاغات من السواقين (' + openIssues.length + ')</h3></div><ul class="list">';
      openIssues.forEach(function (r) {
        h += '<li>' +
          '<span class="tag ' + (r.severity === 'عاجل' ? 'bad' : r.severity === 'مهم' ? 'warn' : '') + ' dot">' + esc(r.severity) + '</span>' +
          '<div style="flex:1;min-width:0">' +
            '<div class="ttl">' + esc(M.vehicleName(r.vehicleId)) + ' — ' + esc(r.type) + '</div>' +
            '<div class="sub">' + esc(r.description) + '</div>' +
            '<div class="sub muted">' + esc(M.staffName(r.staffId)) + ' · ' + esc(AMB.fmtStamp(r.ts)) +
              (r.status && r.status !== 'جديد' ? ' · ' + esc(r.status) : '') + '</div>' +
          '</div>' +
          (r.lat != null ? '<button class="btn sm" data-issueloc="' + r._id + '">📍</button> ' : '') +
          '<button class="btn sm acc" data-issuefix="' + r._id + '">حوّل لصيانة</button> ' +
          '<button class="btn sm" data-issuedone="' + r._id + '">✓ تم الحل</button>' +
        '</li>';
      });
      h += '</ul></div>';
    }

    if (due.length) {
      h += '<div class="card"><div class="card-h" style="background:var(--warn-bg)"><h3>⚙ مستحقة الآن</h3></div><ul class="list">';
      due.forEach(function (d) {
        h += '<li><span class="tag ' + (d.overdue ? 'bad' : 'warn') + ' dot">' + esc(d.reason) + '</span>' +
          '<div style="flex:1"><div class="ttl">' + esc(M.vehicleName(d.vehicleId)) + ' — ' + esc(d.record.type || 'صيانة') + '</div>' +
          '<div class="sub">آخر مرة: ' + esc(AMB.fmtDayShort(d.record.date)) +
          (d.record.odometer ? ' عند ' + num(d.record.odometer, 0) + ' كم' : '') + '</div></div>' +
          '<button class="btn sm pri" data-maintdone="' + d.record._id + '">تم التنفيذ</button></li>';
      });
      h += '</ul></div>';
    }

    var filtered = recs.filter(function (r) { return !maintVeh || r.vehicleId === maintVeh; });

    if (!filtered.length) {
      h += '<div class="card"><div class="card-b tight">' +
        UI.empty('⚙', 'مفيش سجلات صيانة', 'سجّل كل صيانة عشان النظام يعرف ينبهك على المواعيد الجاية') + '</div></div>';
    } else {
      var totalCost = filtered.reduce(function (a, r) { return a + (Number(r.cost) || 0); }, 0);
      h += '<div class="card"><div class="card-h"><h3>سجل الصيانة</h3><span class="spacer"></span>' +
           '<span class="tag">' + filtered.length + ' سجل · إجمالي ' + esc(fmoney(totalCost)) + '</span></div>' +
           '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
        '<th>التاريخ</th><th>السيارة</th><th>النوع</th><th>العداد</th><th>الورشة</th><th>التكلفة</th><th>الموعد الجاي</th><th>الحالة</th><th></th>' +
        '</tr></thead><tbody>';
      filtered.forEach(function (r) {
        h += '<tr>' +
          '<td class="num nowrap">' + esc(AMB.fmtDayShort(r.date)) + '</td>' +
          '<td class="nowrap">' + esc(M.vehicleName(r.vehicleId)) + '</td>' +
          '<td>' + esc(r.type || '—') + '</td>' +
          '<td class="num">' + (r.odometer ? num(r.odometer, 0) : '—') + '</td>' +
          '<td class="small">' + esc(r.workshop || '—') + '</td>' +
          '<td class="num nowrap">' + esc(fmoney(r.cost)) + '</td>' +
          '<td class="small nowrap">' + (r.nextDate ? esc(AMB.fmtDayShort(r.nextDate)) : '') +
             (r.nextKm ? (r.nextDate ? ' / ' : '') + num(r.nextKm, 0) + ' كم' : '') +
             (!r.nextDate && !r.nextKm ? '<span class="muted">—</span>' : '') + '</td>' +
          '<td>' + (r.status === 'تمت' ? '<span class="tag ok">تمت</span>' : '<span class="tag warn">' + esc(r.status || 'قيد التنفيذ') + '</span>') + '</td>' +
          '<td class="acts no-print"><button class="btn sm" data-maint="' + r._id + '">✎</button></td>' +
        '</tr>';
      });
      h += '</tbody></table></div></div>';
    }

    host.innerHTML = h;
    host.querySelector('#mfVeh').onchange = function () { maintVeh = this.value; render(); };
    host.querySelector('#addMaint').onclick = function () { editMaint(null, maintVeh || null); };
    host.querySelector('#mfExp').onclick = function () {
      var rows = [['التاريخ', 'السيارة', 'النوع', 'العداد', 'الورشة', 'قطع الغيار', 'التكلفة', 'الموعد الجاي (تاريخ)', 'الموعد الجاي (كم)', 'الحالة', 'ملاحظات']];
      filtered.forEach(function (r) {
        rows.push([r.date, M.vehicleName(r.vehicleId), r.type, r.odometer || '', r.workshop || '',
                   r.parts || '', r.cost || 0, r.nextDate || '', r.nextKm || '', r.status || '', r.notes || '']);
      });
      UI.downloadCSV('سجل-الصيانة.csv', rows); AMB.toast('تم التصدير', 'ok');
    };
    host.querySelectorAll('[data-maint]').forEach(function (b) { b.onclick = function () { editMaint(b.dataset.maint); }; });
    host.querySelectorAll('[data-maintdone]').forEach(function (b) {
      b.onclick = function () {
        var old = S.byId('maintenance', b.dataset.maintdone);
        editMaint(null, old.vehicleId, { type: old.type, notes: 'تكرار لـ: ' + (old.type || 'صيانة') });
      };
    });

    /* أزرار البلاغات */
    host.querySelectorAll('[data-issuefix]').forEach(function (b) {
      b.onclick = function () {
        var r = S.byId('incidents', b.dataset.issuefix);
        editMaint(null, r.vehicleId, {
          type: mapIssueType(r.type),
          notes: 'بلاغ من ' + M.staffName(r.staffId) + ' (' + AMB.fmtDayShort(AMB.toISODay(new Date(r.ts))) + '): ' + r.description,
          status: 'قيد التنفيذ'
        }, function () {
          /* نعلّم البلاغ بعد الحفظ الفعلي — مش بمجرد فتح النافذة */
          r.status = 'حُوِّل لصيانة';
          S.put('incidents', r);
        });
      };
    });
    host.querySelectorAll('[data-issuedone]').forEach(function (b) {
      b.onclick = function () {
        var r = S.byId('incidents', b.dataset.issuedone);
        r.status = 'تم الحل'; r.resolvedAt = Date.now();
        S.put('incidents', r);
        AMB.toast('تم إغلاق البلاغ', 'ok');
      };
    });
    host.querySelectorAll('[data-issueloc]').forEach(function (b) {
      b.onclick = function () {
        var r = S.byId('incidents', b.dataset.issueloc);
        if (r.lat != null) window.open('https://www.google.com/maps?q=' + r.lat + ',' + r.lng, '_blank', 'noopener');
      };
    });
  }

  function mapIssueType(t) {
    var map = { 'عطل ميكانيكي': 'عطل طارئ', 'كهرباء': 'كهرباء', 'إطار': 'إطارات',
                'فرامل': 'فرامل', 'تكييف / تبريد': 'تبريد وتكييف',
                'نقص أجهزة طبية': 'أجهزة طبية', 'نقص مستلزمات': 'أخرى',
                'حادث': 'عطل طارئ', 'أخرى': 'أخرى' };
    return map[t] || 'أخرى';
  }

  var maintVeh = '';

  function editMaint(id, vehicleId, preset, onSaved) {
    var vehicles = S.all('vehicles');
    if (!vehicles.length) { AMB.toast('أضف سيارة الأول', 'warn'); go('fleet'); return; }

    var rec = id ? Object.assign({}, S.byId('maintenance', id)) : Object.assign({
      vehicleId: vehicleId || vehicles[0]._id, date: AMB.today(), type: 'صيانة دورية',
      odometer: vehicleId ? M.odometer(vehicleId) : '', workshop: '', parts: '',
      cost: '', nextDate: '', nextKm: '', status: 'تمت', notes: ''
    }, preset || {});

    var ids = {};
    function F(o) { ids[o.key] = { id: AMB.uid('f'), type: o.type }; o.id = ids[o.key].id; return UI.field(o); }

    var body =
      '<div class="row">' +
        F({ key: 'vehicleId', label: 'السيارة', type: 'select', value: rec.vehicleId,
            options: vehicles.map(function (v) { return { value: v._id, text: v.name }; }) }) +
        F({ key: 'date', label: 'التاريخ', type: 'date', value: rec.date }) +
        F({ key: 'type', label: 'نوع الصيانة', type: 'select', value: rec.type, options: MAINT_TYPES }) +
      '</div>' +
      '<div class="row">' +
        F({ key: 'odometer', label: 'قراءة العداد (كم)', type: 'number', value: rec.odometer, min: 0 }) +
        F({ key: 'cost', label: 'التكلفة (ج)', type: 'number', value: rec.cost, min: 0 }) +
        F({ key: 'status', label: 'الحالة', type: 'select', value: rec.status, options: ['تمت', 'قيد التنفيذ', 'مؤجلة'] }) +
      '</div>' +
      F({ key: 'workshop', label: 'الورشة / الفني', value: rec.workshop, placeholder: 'ورشة الحاج سيد — 010...' }) +
      F({ key: 'parts', label: 'قطع الغيار المستبدلة', value: rec.parts, placeholder: 'فلتر زيت، 4 لتر زيت 20W50' }) +
      '<div class="note">💡 املأ خانة أو اتنين من دول عشان النظام ينبهك تلقائياً قبل الموعد الجاي. ' +
      '<span id="_every"></span></div>' +
      '<div class="row">' +
        F({ key: 'nextDate', label: 'الصيانة الجاية — بتاريخ', type: 'date', value: rec.nextDate,
            hint: 'التنبيه بيظهر قبلها بأسبوعين' }) +
        F({ key: 'nextKm', label: 'الصيانة الجاية — عند عداد (كم)', type: 'number', value: rec.nextKm, min: 0,
            hint: 'التنبيه بيظهر قبلها بـ 1000 كم' }) +
      '</div>' +
      F({ key: 'notes', label: 'ملاحظات', type: 'textarea', value: rec.notes, rows: 2 });

    var btns = [{ text: id ? 'حفظ' : 'إضافة', cls: 'pri', keepOpen: true, onClick: function (api) {
      var d = UI.readForm(api.body, ids);
      d.cost = Number(d.cost) || 0;
      d.odometer = Number(d.odometer) || 0;
      d.nextKm = Number(d.nextKm) || 0;
      Object.assign(rec, d);
      S.put('maintenance', rec);
      /* حدّث عداد السيارة لو أعلى */
      var v = S.byId('vehicles', rec.vehicleId);
      if (v && rec.odometer > (Number(v.odometer) || 0)) { v.odometer = rec.odometer; S.put('vehicles', v); }
      if (onSaved) onSaved(rec);
      api.close(); AMB.toast('تم الحفظ', 'ok'); return true;
    } }];
    if (id) btns.push({ text: 'حذف', cls: 'danger', keepOpen: true, onClick: function (api) {
      UI.confirm('حذف سجل الصيانة؟', { danger: true }).then(function (ok) {
        if (ok) { S.remove('maintenance', id); api.close(); AMB.toast('تم الحذف'); }
      }); return false;
    } });
    btns.push({ spacer: true }, { text: 'إغلاق' });

    var m = UI.modal({ title: id ? 'تعديل سجل صيانة' : 'سجل صيانة جديد', body: body, buttons: btns });
    /* عند تغيير السيارة، اقترح العداد */
    m.body.querySelector('#' + ids.vehicleId.id).onchange = function () {
      var o = m.body.querySelector('#' + ids.odometer.id);
      if (!o.value || Number(o.value) === 0) o.value = M.odometer(this.value) || '';
      suggestNext(true);
    };

    /* اقتراح الموعد الجاي حسب نوع الصيانة */
    function suggestNext(force) {
      var type = m.body.querySelector('#' + ids.type.id).value;
      var ev = MAINT_EVERY[type];
      var box = m.body.querySelector('#_every');
      var nd = m.body.querySelector('#' + ids.nextDate.id);
      var nk = m.body.querySelector('#' + ids.nextKm.id);

      if (!ev) { box.innerHTML = ''; return; }
      box.innerHTML = 'المعتاد لـ«' + esc(type) + '»: <strong>' + esc(ev.label) + '</strong> ' +
                      '<button type="button" class="btn sm" id="_applyEvery">طبّقه</button>';
      box.querySelector('#_applyEvery').onclick = function () { apply(); };
      if (force || (!nd.value && !nk.value)) apply();

      function apply() {
        if (ev.days) {
          var base = AMB.parseDay(m.body.querySelector('#' + ids.date.id).value) || new Date();
          nd.value = AMB.toISODay(new Date(base.getTime() + ev.days * 86400000));
        }
        if (ev.km) {
          var odo = Number(m.body.querySelector('#' + ids.odometer.id).value) || 0;
          if (odo) nk.value = odo + ev.km;
        }
      }
    }
    m.body.querySelector('#' + ids.type.id).onchange = function () { suggestNext(true); };
    m.body.querySelector('#' + ids.odometer.id).addEventListener('change', function () { suggestNext(false); });
    if (!id) suggestNext(true); else suggestNext(false);
  }

  /* ============================================================
     7) التفويل
     ============================================================ */

  function viewFuel(host) {
    var recs = S.all('fuel').sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    var filtered = recs.filter(function (r) { return !fuelVeh || r.vehicleId === fuelVeh; });

    var h = '<div class="filters no-print">' +
      '<label>السيارة</label><select id="ffVeh"><option value="">الكل</option>' +
      S.all('vehicles').map(function (v) { return '<option value="' + v._id + '"' + (fuelVeh === v._id ? ' selected' : '') + '>' + esc(v.name) + '</option>'; }).join('') + '</select>' +
      '<span class="spacer"></span><button class="btn sm" id="ffExp">⤓ تصدير</button>' +
      '<button class="btn pri sm" id="addFuel">+ تفويل</button></div>';

    /* ملخص الشهر */
    var mStart = AMB.today().slice(0, 8) + '01';
    var mRecs = filtered.filter(function (r) { return r.date >= mStart; });
    var mLiters = mRecs.reduce(function (a, r) { return a + (Number(r.liters) || 0); }, 0);
    var mCost = mRecs.reduce(function (a, r) { return a + (Number(r.total) || 0); }, 0);

    h += '<div class="grid g4" style="margin-bottom:14px">' +
      stat('تكلفة الشهر', fmoney(mCost), mRecs.length + ' عملية تفويل', '#a86300') +
      stat('لترات الشهر', num(mLiters, 0) + ' لتر', mLiters ? 'بمتوسط ' + fnum(mCost / mLiters, 2) + ' ج/لتر' : '', '#1d75d8') +
      stat('إجمالي السجل', fmoney(filtered.reduce(function (a, r) { return a + (Number(r.total) || 0); }, 0)), filtered.length + ' عملية', '#7b61ff') +
      '</div>';

    /* استهلاك كل سيارة */
    var vehs = S.all('vehicles').filter(function (v) { return !fuelVeh || v._id === fuelVeh; });
    if (vehs.length) {
      h += '<div class="card"><div class="card-h"><h3>معدل الاستهلاك</h3></div><ul class="list">';
      vehs.forEach(function (v) {
        var c = M.consumption(v._id);
        h += '<li><span class="swatch" style="width:14px;height:14px;background:' + esc(v.color) + '"></span>' +
          '<div style="flex:1"><div class="ttl">' + esc(v.name) + '</div>' +
          '<div class="sub">' + (c ? num(c.km, 0) + ' كم على ' + num(c.liters, 1) + ' لتر (' + c.fills + ' تعبئة)'
                                  : 'محتاج تعبئتين على الأقل بقراءات عداد صحيحة') + '</div></div>' +
          '<div style="text-align:end"><div class="ttl">' + (c ? num(c.kmPerLiter, 1) + ' <span class="small muted">كم/لتر</span>' : '—') + '</div>' +
          (c ? '<div class="sub">' + num(100 / c.kmPerLiter, 1) + ' لتر/100كم</div>' : '') + '</div></li>';
      });
      h += '</ul></div>';
    }

    if (!filtered.length) {
      h += '<div class="card"><div class="card-b tight">' +
        UI.empty('⛽', 'مفيش سجلات تفويل', 'سجّل كل تعبئة بقراءة العداد عشان النظام يحسب الاستهلاك') + '</div></div>';
    } else {
      h += '<div class="card"><div class="card-h"><h3>سجل التفويل</h3></div><div class="tbl-wrap"><table class="tbl"><thead><tr>' +
        '<th>التاريخ</th><th>السيارة</th><th>لتر</th><th>سعر اللتر</th><th>الإجمالي</th><th>العداد</th><th>المحطة</th><th>السائق</th><th></th>' +
        '</tr></thead><tbody>';
      filtered.forEach(function (r) {
        h += '<tr>' +
          '<td class="num nowrap">' + esc(AMB.fmtDayShort(r.date)) + '</td>' +
          '<td class="nowrap">' + esc(M.vehicleName(r.vehicleId)) + '</td>' +
          '<td class="num">' + num(r.liters, 1) + '</td>' +
          '<td class="num">' + num(r.price, 2) + '</td>' +
          '<td class="num nowrap"><strong>' + esc(fmoney(r.total)) + '</strong></td>' +
          '<td class="num">' + (r.odometer ? num(r.odometer, 0) : '<span class="muted">—</span>') + '</td>' +
          '<td class="small">' + esc(r.station || '—') + '</td>' +
          '<td class="small">' + esc(r.driverId ? M.staffName(r.driverId) : '—') + '</td>' +
          '<td class="acts no-print"><button class="btn sm" data-fuel="' + r._id + '">✎</button></td>' +
        '</tr>';
      });
      h += '</tbody></table></div></div>';
    }

    host.innerHTML = h;
    host.querySelector('#ffVeh').onchange = function () { fuelVeh = this.value; render(); };
    host.querySelector('#addFuel').onclick = function () { editFuel(null, fuelVeh || null); };
    host.querySelector('#ffExp').onclick = function () {
      var rows = [['التاريخ', 'السيارة', 'لتر', 'سعر اللتر', 'الإجمالي', 'العداد', 'المحطة', 'السائق', 'ملاحظات']];
      filtered.forEach(function (r) {
        rows.push([r.date, M.vehicleName(r.vehicleId), r.liters, r.price, r.total, r.odometer || '',
                   r.station || '', r.driverId ? M.staffName(r.driverId) : '', r.notes || '']);
      });
      UI.downloadCSV('سجل-التفويل.csv', rows); AMB.toast('تم التصدير', 'ok');
    };
    host.querySelectorAll('[data-fuel]').forEach(function (b) { b.onclick = function () { editFuel(b.dataset.fuel); }; });
  }

  var fuelVeh = '';

  function editFuel(id, vehicleId) {
    var vehicles = S.all('vehicles');
    if (!vehicles.length) { AMB.toast('أضف سيارة الأول', 'warn'); go('fleet'); return; }
    var drivers = S.all('staff').sort(byName);

    var rec = id ? Object.assign({}, S.byId('fuel', id)) : {
      vehicleId: vehicleId || vehicles[0]._id, date: AMB.today(),
      liters: '', price: '', total: '', odometer: '', station: '', driverId: '', notes: ''
    };

    var ids = {};
    function F(o) { ids[o.key] = { id: AMB.uid('f'), type: o.type }; o.id = ids[o.key].id; return UI.field(o); }

    var body =
      '<div class="row">' +
        F({ key: 'vehicleId', label: 'السيارة', type: 'select', value: rec.vehicleId,
            options: vehicles.map(function (v) { return { value: v._id, text: v.name }; }) }) +
        F({ key: 'date', label: 'التاريخ', type: 'date', value: rec.date }) +
      '</div>' +
      '<div class="row">' +
        F({ key: 'liters', label: 'عدد اللترات', type: 'number', value: rec.liters, min: 0, step: '0.1', req: true }) +
        F({ key: 'price', label: 'سعر اللتر (ج)', type: 'number', value: rec.price, min: 0, step: '0.01' }) +
        F({ key: 'total', label: 'الإجمالي (ج)', type: 'number', value: rec.total, min: 0, step: '0.01' }) +
      '</div>' +
      '<div class="note">اكتب اتنين من التلاتة والتالت هيتحسب لوحده.</div>' +
      '<div class="row">' +
        F({ key: 'odometer', label: 'قراءة العداد (كم)', type: 'number', value: rec.odometer, min: 0,
            hint: 'مهمة جداً — من غيرها مش هينفع نحسب الاستهلاك' }) +
        F({ key: 'station', label: 'المحطة', value: rec.station, placeholder: 'موبيل — طريق النصر' }) +
      '</div>' +
      F({ key: 'driverId', label: 'السائق', type: 'select', value: rec.driverId,
          options: [{ value: '', text: '— غير محدد —' }].concat(drivers.map(function (s) { return { value: s._id, text: s.name }; })) }) +
      F({ key: 'notes', label: 'ملاحظات', type: 'textarea', value: rec.notes, rows: 2 });

    var btns = [{ text: id ? 'حفظ' : 'إضافة', cls: 'pri', keepOpen: true, onClick: function (api) {
      var d = UI.readForm(api.body, ids);
      d.liters = Number(d.liters) || 0;
      d.price = Number(d.price) || 0;
      d.total = Number(d.total) || 0;
      d.odometer = Number(d.odometer) || 0;
      if (!d.liters) { AMB.toast('عدد اللترات مطلوب', 'error'); return false; }
      Object.assign(rec, d);
      S.put('fuel', rec);
      var v = S.byId('vehicles', rec.vehicleId);
      if (v && rec.odometer > (Number(v.odometer) || 0)) { v.odometer = rec.odometer; S.put('vehicles', v); }
      api.close(); AMB.toast('تم الحفظ', 'ok'); return true;
    } }];
    if (id) btns.push({ text: 'حذف', cls: 'danger', keepOpen: true, onClick: function (api) {
      UI.confirm('حذف سجل التفويل؟', { danger: true }).then(function (ok) {
        if (ok) { S.remove('fuel', id); api.close(); AMB.toast('تم الحذف'); }
      }); return false;
    } });
    btns.push({ spacer: true }, { text: 'إغلاق' });

    var m = UI.modal({ title: id ? 'تعديل تفويل' : 'تسجيل تفويل', body: body, buttons: btns });

    /* حساب تلقائي للحقل الناقص */
    var L = m.body.querySelector('#' + ids.liters.id);
    var P = m.body.querySelector('#' + ids.price.id);
    var T = m.body.querySelector('#' + ids.total.id);
    var lastEdited = [];
    function track(el, name) {
      el.addEventListener('input', function () {
        lastEdited = [name].concat(lastEdited.filter(function (x) { return x !== name; })).slice(0, 2);
        var l = Number(L.value), p = Number(P.value), t = Number(T.value);
        var has = lastEdited.slice(0, 2);
        if (has.indexOf('l') > -1 && has.indexOf('p') > -1 && l && p) T.value = (l * p).toFixed(2);
        else if (has.indexOf('l') > -1 && has.indexOf('t') > -1 && l && t) P.value = (t / l).toFixed(2);
        else if (has.indexOf('p') > -1 && has.indexOf('t') > -1 && p && t) L.value = (t / p).toFixed(1);
      });
    }
    track(L, 'l'); track(P, 'p'); track(T, 't');

    m.body.querySelector('#' + ids.vehicleId.id).onchange = function () {
      var o = m.body.querySelector('#' + ids.odometer.id);
      if (!o.value) o.value = M.odometer(this.value) || '';
    };
  }

  /* ============================================================
     8) الأفراد
     ============================================================ */

  function viewStaff(host) {
    var staff = S.all('staff').sort(byName);
    var h = '<div class="filters no-print"><span class="spacer"></span>' +
            '<button class="btn sm" id="stExp">⤓ تصدير</button>' +
            '<button class="btn pri sm" id="addStaff">+ فرد جديد</button></div>';

    if (!staff.length) {
      h += '<div class="card"><div class="card-b tight">' +
        UI.empty('☺', 'مفيش أفراد مسجلين', 'سجّل السواقين والمسعفين عشان تقدر تكلّفهم بالمهام وتتابع حضورهم',
                 '<button class="btn pri" id="addStaff2">أضف أول فرد</button>') + '</div></div>';
    } else {
      var mStart = AMB.today().slice(0, 8) + '01';
      h += '<div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr>' +
        '<th>الاسم</th><th>الوظيفة</th><th>الموبايل</th><th>الرقم القومي</th><th>مهام الشهر</th><th>آخر حركة</th><th>رابط الموبايل</th><th></th>' +
        '</tr></thead><tbody>';
      staff.forEach(function (s) {
        var jobs = M.assignmentsBetween(mStart, AMB.today().slice(0, 8) + '31')
                    .filter(function (a) { return (a.crew || []).indexOf(s._id) > -1 && a.status !== 'ملغاة'; }).length;
        var last = S.all('attendance').filter(function (r) { return r.staffId === s._id; })
                    .sort(function (a, b) { return b.ts - a.ts; })[0];
        h += '<tr>' +
          '<td><strong>' + esc(s.name) + '</strong></td>' +
          '<td>' + esc(s.role || '—') + '</td>' +
          '<td class="mono small">' + esc(s.phone || '—') + '</td>' +
          '<td class="mono small">' + esc(s.nid || '—') + '</td>' +
          '<td class="num">' + jobs + '</td>' +
          '<td class="small">' + (last ? esc(AMB.ago(last.ts)) : '<span class="muted">لا يوجد</span>') + '</td>' +
          '<td class="no-print"><button class="btn sm" data-link="' + s._id + '">📱 نسخ</button></td>' +
          '<td class="acts no-print"><button class="btn sm" data-staff="' + s._id + '">✎</button></td>' +
        '</tr>';
      });
      h += '</tbody></table></div></div>';
    }

    host.innerHTML = h;
    var add = function () { editStaff(null); };
    host.querySelector('#addStaff').onclick = add;
    var a2 = host.querySelector('#addStaff2'); if (a2) a2.onclick = add;
    host.querySelectorAll('[data-staff]').forEach(function (b) { b.onclick = function () { editStaff(b.dataset.staff); }; });
    host.querySelectorAll('[data-link]').forEach(function (b) {
      b.onclick = function () { showDriverLink(b.dataset.link); };
    });
    var ex = host.querySelector('#stExp');
    if (ex) ex.onclick = function () {
      var rows = [['الاسم', 'الوظيفة', 'الموبايل', 'الرقم القومي', 'رقم الرخصة', 'تاريخ انتهاء الرخصة', 'العنوان', 'ملاحظات']];
      staff.forEach(function (s) {
        rows.push([s.name, s.role || '', s.phone || '', s.nid || '', s.license || '', s.licenseExp || '', s.address || '', s.notes || '']);
      });
      UI.downloadCSV('بيانات-الأفراد.csv', rows); AMB.toast('تم التصدير', 'ok');
    };
  }

  function editStaff(id) {
    var rec = id ? Object.assign({}, S.byId('staff', id)) :
      { name: '', role: 'مسعف', phone: '', nid: '', license: '', licenseExp: '', address: '', notes: '' };
    var ids = {};
    function F(o) { ids[o.key] = { id: AMB.uid('f'), type: o.type }; o.id = ids[o.key].id; return UI.field(o); }

    var body =
      '<div class="row">' +
        F({ key: 'name', label: 'الاسم', value: rec.name, req: true }) +
        F({ key: 'role', label: 'الوظيفة', type: 'select', value: rec.role, options: ROLES }) +
      '</div>' +
      '<div class="field"><label>الحضور والانصراف</label>' +
        '<label class="chk" id="_attWrap"><input type="checkbox" id="_att"' +
        (M.countsAttendance(rec._id || '__new__') || (!id && !M.NO_ATTENDANCE_ROLES[rec.role]) ? ' checked' : '') +
        '> يُحسب في تقارير الحضور والتأخير</label>' +
        '<div class="hint" id="_attHint"></div></div>' +
      '<div class="row">' +
        F({ key: 'phone', label: 'الموبايل', type: 'tel', value: rec.phone, placeholder: '01xxxxxxxxx' }) +
        F({ key: 'nid', label: 'الرقم القومي', value: rec.nid }) +
        F({ key: 'ratePerJob', label: 'أجر المباراة الواحدة (ج)', type: 'number', value: rec.ratePerJob, min: 0,
            hint: 'منه بتتحسب مستحقاته الأسبوعية. سيبه فاضي عشان ياخد الافتراضي بتاع وظيفته.' }) +
        F({ key: 'bonusPerJob', label: 'بونص المباراة (ج)', type: 'number', value: rec.bonusPerJob, min: 0,
            hint: 'فاضي = ياخد الافتراضي · صفر = مستثنى من البونص' }) +
      '</div>' +
      '<div class="row">' +
        F({ key: 'license', label: 'رقم الرخصة', value: rec.license }) +
        F({ key: 'licenseExp', label: 'انتهاء الرخصة', type: 'date', value: rec.licenseExp }) +
      '</div>' +
      F({ key: 'address', label: 'العنوان', value: rec.address }) +
      F({ key: 'notes', label: 'ملاحظات', type: 'textarea', value: rec.notes, rows: 2 });

    var btns = [{ text: id ? 'حفظ' : 'إضافة', cls: 'pri', keepOpen: true, onClick: function (api) {
      var d = UI.readForm(api.body, ids);
      if (!d.name) { AMB.toast('الاسم مطلوب', 'error'); return false; }
      d.countsAttendance = api.body.querySelector('#_att').checked;
      d.ratePerJob = Number(d.ratePerJob) || 0;
      /* فاضي = وَرِّث الافتراضي · صفر = مستثنى — لازم نفرّق بينهم */
      var bp = api.body.querySelector('#' + ids.bonusPerJob.id).value.trim();
      d.bonusPerJob = bp === '' ? null : (Number(bp) || 0);
      Object.assign(rec, d); S.put('staff', rec); api.close(); AMB.toast('تم الحفظ', 'ok'); return true;
    } }];
    if (id) btns.push({ text: 'حذف', cls: 'danger', keepOpen: true, onClick: function (api) {
      UI.confirm('حذف ' + rec.name + '؟', { danger: true }).then(function (ok) {
        if (ok) { S.remove('staff', id); api.close(); AMB.toast('تم الحذف'); }
      }); return false;
    } });
    btns.push({ spacer: true }, { text: 'إغلاق' });

    var m = UI.modal({ title: id ? 'تعديل بيانات فرد' : 'فرد جديد', body: body, buttons: btns });

    var roleSel = m.body.querySelector('#' + ids.role.id);
    var attBox = m.body.querySelector('#_att');
    var attHint = m.body.querySelector('#_attHint');
    var touched = false;
    attBox.addEventListener('change', function () {
      touched = true;
      m.body.querySelector('#_attWrap').classList.toggle('on', attBox.checked);
      hint();
    });
    roleSel.addEventListener('change', function () {
      if (!touched) attBox.checked = !M.NO_ATTENDANCE_ROLES[roleSel.value];
      m.body.querySelector('#_attWrap').classList.toggle('on', attBox.checked);
      hint();
    });
    function hint() {
      attHint.textContent = attBox.checked
        ? 'حركاته هتظهر في شاشة الحضور وهيتحسبله تأخير في تقرير الانضباط.'
        : 'حركاته هتتسجّل كحركة سيارة للتتبع — لكن مش هيتحسبله حضور ولا تأخير. ' +
          'ده الافتراضي للسواقين والفنيين.';
    }
    m.body.querySelector('#_attWrap').classList.toggle('on', attBox.checked);
    hint();
  }

  /* ============================================================
     9) الملاعب
     ============================================================ */

  function viewVenues(host) {
    var venues = S.all('venues').sort(byOrder);
    var noLoc = venues.filter(function (v) { return v.lat == null; });

    var h = '<div class="filters no-print">' +
            '<span class="small muted">رتّب الأندية بالأولوية — الترتيب ده بيظهر في كل قوايم الاختيار</span>' +
            '<span class="spacer"></span>' +
            '<button class="btn sm" id="sortAZ">ترتيب أبجدي</button>' +
            '<button class="btn pri sm" id="addVenue">+ ملعب جديد</button></div>';

    if (noLoc.length) {
      h += '<div class="note warn"><strong>' + noLoc.length + ' ملعب من غير موقع.</strong> ' +
        'من غير الموقع، تسجيل الحضور بالـ GPS مش هيشتغل للملاعب دي. ' +
        'أسهل طريقة: وأنت واقف في الملعب، افتح النظام واضغط «خذ موقعي الآن».</div>';
    }

    h += '<div class="card"><div id="venuesMap" class="map-mid"></div></div>';

    h += '<div class="card"><div class="tbl-wrap"><table class="tbl" id="venuesTbl"><thead><tr>' +
      '<th style="width:1%">#</th><th style="width:1%">ترتيب</th>' +
      '<th>الملعب / النادي</th><th>الموقع</th><th>نطاق الحضور</th><th>مبلغ افتراضي</th><th>مسؤول التواصل</th><th>مهام سابقة</th><th></th>' +
      '</tr></thead><tbody>';
    venues.forEach(function (v, i) {
      var jobs = S.all('assignments').filter(function (a) { return a.venueId === v._id; }).length;
      h += '<tr draggable="true" data-row="' + v._id + '">' +
        '<td class="num"><span class="rank' + (i < 3 ? ' top' : '') + '">' + (i + 1) + '</span></td>' +
        '<td class="no-print nowrap">' +
          '<button class="btn sm mv" data-up="' + v._id + '"' + (i === 0 ? ' disabled' : '') + ' title="تحريك لفوق">▲</button>' +
          '<button class="btn sm mv" data-down="' + v._id + '"' + (i === venues.length - 1 ? ' disabled' : '') + ' title="تحريك لتحت">▼</button>' +
          '<button class="btn sm mv" data-top="' + v._id + '"' + (i === 0 ? ' disabled' : '') + ' title="نقل لأول القائمة">⤒</button>' +
        '</td>' +
        '<td><span class="grip" title="اسحب للترتيب">⠿</span> <strong>' + esc(v.name) + '</strong>' +
          (v.address ? '<div class="sub small muted">' + esc(v.address) + '</div>' : '') + '</td>' +
        '<td>' + (v.lat != null ? '<span class="tag ok dot">محدد</span> <span class="mono small muted">' + v.lat.toFixed(4) + ', ' + v.lng.toFixed(4) + '</span>'
                                : '<span class="tag bad">غير محدد</span>') + '</td>' +
        '<td class="num">' + (v.lat != null ? (v.radius || 200) + ' م' : '—') + '</td>' +
        '<td class="num nowrap">' + (v.defaultFee ? esc(fmoney(v.defaultFee)) : '—') + '</td>' +
        '<td class="small">' + esc(v.contact || '—') + (v.phone ? '<div class="mono muted">' + esc(v.phone) + '</div>' : '') + '</td>' +
        '<td class="num">' + jobs + '</td>' +
        '<td class="acts no-print">' +
          '<button class="btn sm ' + (v.lat == null ? 'acc' : '') + '" data-vloc="' + v._id + '">📍 ' + (v.lat == null ? 'حدد' : 'عدّل') + '</button> ' +
          '<button class="btn sm" data-venue="' + v._id + '" title="تعديل البيانات">✎</button> ' +
          '<button class="btn sm danger" data-vdel="' + v._id + '" title="حذف النادي">🗑</button>' +
        '</td>' +
      '</tr>';
    });
    h += '</tbody></table></div></div>';

    host.innerHTML = h;

    var mp = new MiniMap(host.querySelector('#venuesMap'), {});
    var st = S.settings();
    var mk = [], ci = [];
    venues.forEach(function (v) {
      if (v.lat == null) return;
      mk.push({ lat: v.lat, lng: v.lng, color: '#c1121f', kind: 'venue', label: v.name });
      ci.push({ lat: v.lat, lng: v.lng, radius: v.radius || 200, color: '#c1121f' });
    });
    if (st.garage && st.garage.lat != null) {
      mk.push({ lat: st.garage.lat, lng: st.garage.lng, color: '#7b61ff', kind: 'garage', label: st.garage.name || 'الجراج' });
      ci.push({ lat: st.garage.lat, lng: st.garage.lng, radius: st.garage.radius || 200, color: '#7b61ff' });
    }
    mp.setMarkers(mk); mp.setCircles(ci);
    if (mk.length) mp.fit();

    host.querySelector('#addVenue').onclick = function () { editVenue(null); };
    host.querySelectorAll('[data-venue]').forEach(function (b) { b.onclick = function () { editVenue(b.dataset.venue); }; });
    host.querySelectorAll('[data-vdel]').forEach(function (b) {
      b.onclick = function () { deleteVenue(b.dataset.vdel); };
    });

    /* --- الترتيب اليدوي --- */
    host.querySelectorAll('[data-up]').forEach(function (b) { b.onclick = function () { moveVenue(b.dataset.up, -1); }; });
    host.querySelectorAll('[data-down]').forEach(function (b) { b.onclick = function () { moveVenue(b.dataset.down, 1); }; });
    host.querySelectorAll('[data-top]').forEach(function (b) { b.onclick = function () { moveVenue(b.dataset.top, 'top'); }; });

    host.querySelector('#sortAZ').onclick = function () {
      UI.confirm('ترتيب الأندية أبجدياً؟', { detail: 'ده هيلغي الترتيب اليدوي اللي عملته.' })
        .then(function (ok) {
          if (!ok) return;
          var list = S.all('venues').sort(byName);
          list.forEach(function (v, i) { v.order = i; });
          S.putBatch('venues', list);
          AMB.toast('تم الترتيب أبجدياً', 'ok');
        });
    };

    /* السحب والإفلات */
    var dragId = null;
    host.querySelectorAll('#venuesTbl tbody tr').forEach(function (tr) {
      tr.addEventListener('dragstart', function (e) {
        dragId = tr.dataset.row;
        tr.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', dragId); } catch (err) { }
      });
      tr.addEventListener('dragend', function () {
        tr.classList.remove('dragging');
        host.querySelectorAll('#venuesTbl tbody tr').forEach(function (r) { r.classList.remove('over'); });
        dragId = null;
      });
      tr.addEventListener('dragover', function (e) {
        if (!dragId || dragId === tr.dataset.row) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        tr.classList.add('over');
      });
      tr.addEventListener('dragleave', function () { tr.classList.remove('over'); });
      tr.addEventListener('drop', function (e) {
        e.preventDefault();
        tr.classList.remove('over');
        var src = dragId || (e.dataTransfer && e.dataTransfer.getData('text/plain'));
        if (src) dropVenue(src, tr.dataset.row);
      });
    });
    host.querySelectorAll('[data-vloc]').forEach(function (b) {
      b.onclick = function () {
        var v = S.byId('venues', b.dataset.vloc);
        UI.pickLocation({
          title: 'موقع ' + v.name, label: v.name, lat: v.lat, lng: v.lng, radius: v.radius || 200,
          others: S.all('venues').filter(function (x) { return x._id !== v._id && x.lat != null; })
        }).then(function (r) {
          if (!r) return;
          v.lat = r.lat; v.lng = r.lng; v.radius = r.radius;
          S.put('venues', v); AMB.toast('تم حفظ موقع ' + v.name, 'ok');
        });
      };
    });
  }

  /* حذف نادي — بنحذّر لو عليه مهام، وبنمنع الحذف لو لسه فيه مهام جاية */
  function deleteVenue(id) {
    var v = S.byId('venues', id);
    if (!v || v._del) return;

    var jobs = S.all('assignments').filter(function (a) { return a.venueId === id; });
    var t = AMB.today();
    var upcoming = jobs.filter(function (a) { return a.date >= t && a.status !== 'ملغاة'; });

    if (upcoming.length) {
      UI.modal({
        title: 'مش هينفع تحذف « ' + v.name + ' » دلوقتي', size: 'narrow',
        body: '<div class="note bad">النادي ده عليه <strong>' + upcoming.length + ' مهمة جاية</strong> لسه ما اتنفذتش:</div>' +
          '<ul class="list" style="border:1px solid var(--line);border-radius:9px">' +
          upcoming.slice(0, 6).sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); })
            .map(function (a) {
              return '<li><div style="flex:1"><div class="ttl">' + esc(AMB.fmtDayShort(a.date)) + ' — ' + esc(AMB.fmtTime(a.time)) + '</div>' +
                     '<div class="sub">' + esc(M.vehicleName(a.vehicleId)) + '</div></div>' + statusTag(a.status) + '</li>';
            }).join('') +
          (upcoming.length > 6 ? '<li class="muted small">و ' + (upcoming.length - 6) + ' مهمة أخرى</li>' : '') +
          '</ul>' +
          '<p class="small muted">امسح المهام دي أو الغيها الأول من شاشة «جدول المباريات»، وبعدين احذف النادي.</p>',
        buttons: [
          { text: 'روح للجدول', cls: 'pri', onClick: function () { go('schedule'); } },
          { spacer: true }, { text: 'إغلاق' }
        ]
      });
      return;
    }

    var detail = jobs.length
      ? 'النادي ده عليه ' + jobs.length + ' مهمة قديمة في السجل. المهام مش هتتمسح، بس هتظهر من غير اسم ملعب — ' +
        'وده هيأثر على تقارير الشهور اللي فاتت.'
      : 'مفيش أي مهام مرتبطة بيه، فالحذف نضيف.';

    UI.confirm('حذف نادي « ' + v.name + ' » نهائياً؟', {
      title: 'تأكيد الحذف', danger: true, yes: 'احذف النادي', detail: detail
    }).then(function (ok) {
      if (!ok) return;
      S.remove('venues', id);
      AMB.toast('تم حذف « ' + v.name + ' »', 'ok');
    });
  }

  function editVenue(id) {
    var rec = id ? Object.assign({}, S.byId('venues', id)) :
      { name: '', address: '', lat: null, lng: null, radius: 200, contact: '', phone: '', defaultFee: '', notes: '' };
    var ids = {};
    function F(o) { ids[o.key] = { id: AMB.uid('f'), type: o.type }; o.id = ids[o.key].id; return UI.field(o); }

    var body =
      F({ key: 'name', label: 'اسم الملعب / النادي', value: rec.name, req: true }) +
      F({ key: 'address', label: 'العنوان', value: rec.address, placeholder: 'مصر الجديدة — شارع...' }) +
      '<div class="row">' +
        F({ key: 'contact', label: 'مسؤول التواصل', value: rec.contact }) +
        F({ key: 'phone', label: 'موبايله', type: 'tel', value: rec.phone }) +
        F({ key: 'defaultFee', label: 'مبلغ التأمين الافتراضي (ج)', type: 'number', value: rec.defaultFee, min: 0,
            hint: 'هيتحط تلقائياً في المهام الجديدة' }) +
      '</div>' +
      F({ key: 'notes', label: 'ملاحظات', type: 'textarea', value: rec.notes, rows: 2,
          placeholder: 'بوابة الدخول، مكان وقوف الإسعاف، إلخ' }) +
      '<div class="field"><label>الموقع على الخريطة</label>' +
        '<div id="_locbox" class="small" style="padding:10px 12px;background:var(--panel2);border:1px solid var(--line);border-radius:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap"></div>' +
      '</div>';

    var loc = { lat: rec.lat, lng: rec.lng, radius: rec.radius || 200 };

    var btns = [{ text: id ? 'حفظ' : 'إضافة', cls: 'pri', keepOpen: true, onClick: function (api) {
      var d = UI.readForm(api.body, ids);
      if (!d.name) { AMB.toast('الاسم مطلوب', 'error'); return false; }
      d.defaultFee = Number(d.defaultFee) || 0;
      Object.assign(rec, d, { lat: loc.lat, lng: loc.lng, radius: loc.radius });
      S.put('venues', rec); api.close(); AMB.toast('تم الحفظ', 'ok'); return true;
    } }];
    if (id) btns.push({ text: '🗑 حذف النادي', cls: 'danger', onClick: function () {
      setTimeout(function () { deleteVenue(id); }, 120);
    } });
    btns.push({ spacer: true }, { text: 'إغلاق' });

    var m = UI.modal({ title: id ? 'تعديل ملعب' : 'ملعب جديد', body: body, buttons: btns });

    function drawLoc() {
      var box = m.body.querySelector('#_locbox');
      box.innerHTML = loc.lat != null
        ? '<span class="tag ok dot">محدد</span><span class="mono">' + loc.lat.toFixed(6) + ', ' + loc.lng.toFixed(6) + '</span>' +
          '<span class="muted">نطاق ' + loc.radius + ' م</span><span style="flex:1"></span>' +
          '<button class="btn sm" id="_pick">تعديل الموقع</button>'
        : '<span class="tag bad">غير محدد</span><span class="muted">من غير موقع، تسجيل الحضور مش هيشتغل</span>' +
          '<span style="flex:1"></span><button class="btn sm acc" id="_pick">حدد الموقع</button>';
      box.querySelector('#_pick').onclick = function () {
        UI.pickLocation({
          title: 'موقع الملعب', lat: loc.lat, lng: loc.lng, radius: loc.radius,
          label: m.body.querySelector('#' + ids.name.id).value || 'الملعب',
          others: S.all('venues').filter(function (x) { return x._id !== id && x.lat != null; })
        }).then(function (r) { if (r) { loc = r; drawLoc(); } });
      };
    }
    drawLoc();
  }

  /* ============================================================
     10) التقارير
     ============================================================ */

  var repFrom = null, repTo = null;

  function viewReports(host) {
    var d = new Date(); d.setDate(1);
    var from = repFrom || AMB.toISODay(d);
    var to = repTo || AMB.today();

    var fin = M.finance(from, to);
    var jobs = M.assignmentsBetween(from, to).filter(function (j) { return j.status !== 'ملغاة'; });

    var h = '<div class="filters no-print">' +
      '<label>من</label><input type="date" id="rpFrom" value="' + from + '">' +
      '<label>إلى</label><input type="date" id="rpTo" value="' + to + '">' +
      '<button class="btn sm" id="rpMonth">الشهر الحالي</button>' +
      '<span class="spacer"></span>' +
      '<button class="btn sm" id="rpPrint">🖨 طباعة</button>' +
      '<button class="btn sm" id="rpExp">⤓ تصدير</button></div>';

    h += '<div class="print-head"><h2>تقرير الفترة من ' + esc(AMB.fmtDay(from)) + ' إلى ' + esc(AMB.fmtDay(to)) + '</h2></div>';

    var pt = payTotals(jobs);

    h += '<div class="grid g4" style="margin-bottom:16px">' +
      stat('الإيراد', fmoney(fin.revenue), fin.jobs + ' مهمة', '#17864a') +
      stat('الوقود', fmoney(fin.fuelCost), num(fin.liters, 0) + ' لتر', '#a86300') +
      stat('الصيانة', fmoney(fin.maintCost), '', '#1d75d8') +
      stat('الصافي', fmoney(fin.net), fin.revenue ? fnum(fin.net / fin.revenue * 100, 0) + '% هامش' : '', fin.net >= 0 ? '#17864a' : '#c1121f') +
      '</div>';

    h += '<div class="grid g3" style="margin-bottom:16px">' +
      stat('محصّل فعلياً', fmoney(pt.collected), pt.nIn + ' مباراة', '#17864a') +
      stat('مع السواقين', fmoney(pt.withDriver), pt.nDriver + ' مباراة', pt.withDriver ? '#a86300' : '#17864a') +
      stat('متأخر على الأندية', fmoney(pt.due), pt.nDue + ' مباراة', pt.due ? '#c1121f' : '#17864a') +
      '</div>';
    if (pt.due) {
      h += '<div class="note warn no-print">الإيراد فوق هو المتفق عليه — لكن <strong>' + esc(fmoney(pt.due)) +
        '</strong> منه فات موعده ولسه ما دخلش. <button class="btn sm" data-go="pay" style="margin-inline-start:6px">شوف التحصيل</button></div>';
    }

    h += '<div class="grid g2">';

    /* إيراد كل ملعب */
    var byVenue = {};
    jobs.forEach(function (j) {
      var k = j.venueId || '_';
      if (!byVenue[k]) byVenue[k] = { n: 0, fee: 0 };
      byVenue[k].n++; byVenue[k].fee += Number(j.fee) || 0;
    });
    var venueRows = Object.keys(byVenue).map(function (k) {
      return { name: M.venueName(k), n: byVenue[k].n, fee: byVenue[k].fee };
    }).sort(function (a, b) { return b.fee - a.fee; });

    h += '<div class="card"><div class="card-h"><h3>الإيراد حسب الملعب</h3></div>';
    if (!venueRows.length) h += '<div class="card-b tight">' + UI.empty('▥', 'لا توجد بيانات') + '</div>';
    else {
      h += '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>الملعب</th><th>عدد المهام</th><th>الإيراد</th><th>المتوسط</th></tr></thead><tbody>';
      venueRows.forEach(function (r) {
        h += '<tr><td>' + esc(r.name) + '</td><td class="num">' + r.n + '</td>' +
             '<td class="num nowrap"><strong>' + esc(fmoney(r.fee)) + '</strong></td>' +
             '<td class="num nowrap">' + esc(fmoney(r.fee / r.n)) + '</td></tr>';
      });
      h += '</tbody></table></div>';
    }
    h += '</div>';

    /* أداء كل سيارة */
    h += '<div class="card"><div class="card-h"><h3>أداء السيارات</h3></div>' +
         '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>السيارة</th><th>مهام</th><th>إيراد</th><th>وقود</th><th>صيانة</th><th>صافي</th></tr></thead><tbody>';
    S.all('vehicles').forEach(function (v) {
      var vj = jobs.filter(function (j) { return j.vehicleId === v._id; });
      var rev = vj.reduce(function (a, j) { return a + (Number(j.fee) || 0); }, 0);
      var fu = S.all('fuel').filter(function (f) { return f.vehicleId === v._id && f.date >= from && f.date <= to; })
                .reduce(function (a, f) { return a + (Number(f.total) || 0); }, 0);
      var ma = S.all('maintenance').filter(function (r) { return r.vehicleId === v._id && r.date >= from && r.date <= to; })
                .reduce(function (a, r) { return a + (Number(r.cost) || 0); }, 0);
      var net = rev - fu - ma;
      h += '<tr><td class="nowrap"><span class="swatch" style="background:' + esc(v.color) + '"></span>' + esc(v.name) + '</td>' +
        '<td class="num">' + vj.length + '</td>' +
        '<td class="num nowrap">' + esc(fmoney(rev)) + '</td>' +
        '<td class="num nowrap">' + esc(fmoney(fu)) + '</td>' +
        '<td class="num nowrap">' + esc(fmoney(ma)) + '</td>' +
        '<td class="num nowrap" style="color:' + (net >= 0 ? 'var(--ok)' : 'var(--bad)') + '"><strong>' + esc(fmoney(net)) + '</strong></td></tr>';
    });
    h += '</tbody></table></div></div>';

    h += '</div>';

    /* انضباط الطاقم */
    var st = S.settings();
    var staffStats = {};
    jobs.forEach(function (j) {
      var target = AMB.parseDay(j.date); var tp = (j.time || '00:00').split(':');
      target.setHours(+tp[0], +tp[1] || 0, 0, 0);
      var mustBy = target.getTime() - (st.arriveBeforeMin || 30) * 60000;
      (j.crew || []).forEach(function (sid) {
        if (!M.countsAttendance(sid)) return;    // السواقين والفنيين مش داخلين تقرير الانضباط
        if (!staffStats[sid]) staffStats[sid] = { assigned: 0, checked: 0, late: 0, outside: 0, totalLate: 0 };
        staffStats[sid].assigned++;
        var a = S.all('attendance').filter(function (r) {
          return r.assignmentId === j._id && r.staffId === sid && r.kind === 'arrive_venue';
        })[0];
        if (a) {
          staffStats[sid].checked++;
          var lateMin = Math.round((a.ts - mustBy) / 60000);
          if (lateMin > (st.lateGraceMin || 15)) { staffStats[sid].late++; staffStats[sid].totalLate += lateMin; }
          if (a.valid === false) staffStats[sid].outside++;
        }
      });
    });

    var sKeys = Object.keys(staffStats);
    if (sKeys.length) {
      h += '<div class="card"><div class="card-h"><h3>انضباط المسعفين</h3><span class="spacer"></span>' +
        '<span class="small muted">السواقين والفنيين مش داخلين · المطلوب الوصول قبل المباراة بـ ' +
        (st.arriveBeforeMin || 30) + ' دقيقة · فترة سماح ' + (st.lateGraceMin || 15) + ' دقيقة</span></div>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>الفرد</th><th>مكلَّف بـ</th><th>سجّل وصول</th><th>نسبة التسجيل</th><th>مرات التأخير</th><th>متوسط التأخير</th><th>خارج النطاق</th></tr></thead><tbody>';
      sKeys.sort(function (a, b) { return staffStats[b].assigned - staffStats[a].assigned; }).forEach(function (sid) {
        var x = staffStats[sid];
        var pct = x.assigned ? Math.round(x.checked / x.assigned * 100) : 0;
        h += '<tr><td><strong>' + esc(M.staffName(sid)) + '</strong></td>' +
          '<td class="num">' + x.assigned + '</td><td class="num">' + x.checked + '</td>' +
          '<td><span class="tag ' + (pct >= 90 ? 'ok' : pct >= 60 ? 'warn' : 'bad') + '">' + pct + '%</span></td>' +
          '<td class="num">' + (x.late ? '<span style="color:var(--bad)">' + x.late + '</span>' : '0') + '</td>' +
          '<td class="num nowrap">' + (x.late ? esc(AMB.fmtMins(x.totalLate / x.late)) : '—') + '</td>' +
          '<td class="num">' + (x.outside ? '<span style="color:var(--bad)">' + x.outside + '</span>' : '0') + '</td></tr>';
      });
      h += '</tbody></table></div></div>';
    }

    host.innerHTML = h;
    host.querySelector('#rpFrom').onchange = function () { repFrom = this.value; render(); };
    host.querySelector('#rpTo').onchange = function () { repTo = this.value; render(); };
    host.querySelector('#rpMonth').onclick = function () {
      var n = new Date(); n.setDate(1);
      repFrom = AMB.toISODay(n); repTo = AMB.today(); render();
    };
    host.querySelectorAll('[data-go]').forEach(function (b) { b.onclick = function () { go(b.dataset.go); }; });
    host.querySelector('#rpPrint').onclick = function () { window.print(); };
    host.querySelector('#rpExp').onclick = function () {
      var rows = [['تقرير من', from, 'إلى', to], [],
        ['الإيراد', fin.revenue], ['الوقود', fin.fuelCost], ['الصيانة', fin.maintCost], ['الصافي', fin.net], [],
        ['الملعب', 'عدد المهام', 'الإيراد']];
      venueRows.forEach(function (r) { rows.push([r.name, r.n, r.fee]); });
      rows.push([], ['المهام التفصيلية'], ['التاريخ', 'الوقت', 'الملعب', 'السيارة', 'الطاقم', 'المبلغ', 'الحالة']);
      jobs.forEach(function (j) {
        rows.push([j.date, j.time, M.venueName(j.venueId), M.vehicleName(j.vehicleId),
          (j.crew || []).map(function (i) { return M.staffName(i); }).join(' / '), j.fee || 0, j.status]);
      });
      UI.downloadCSV('تقرير-' + from + '_' + to + '.csv', rows);
      AMB.toast('تم التصدير', 'ok');
    };
  }

  /* ============================================================
     11) الإعدادات
     ============================================================ */

  function viewSettings(host) {
    var st = S.settings();
    var fb = Sync.config();

    var h = '';

    /* الشركة والجراج */
    h += '<div class="card"><div class="card-h"><h3>بيانات أساسية</h3></div><div class="card-b">' +
      '<div class="row">' +
        '<div class="field"><label>اسم الشركة</label><input type="text" id="stCo" value="' + esc(st.company) + '"></div>' +
        '<div class="field"><label>اسم الجراج / المقر</label><input type="text" id="stGName" value="' + esc(st.garage.name || 'الجراج') + '"></div>' +
      '</div>' +
      '<div class="field"><label>موقع الجراج على الخريطة</label>' +
        '<div id="gBox" class="small" style="padding:10px 12px;background:var(--panel2);border:1px solid var(--line);border-radius:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap"></div>' +
        '<div class="hint">من هنا بيتحسب «وقت الخروج من الجراج» و«العودة». وأنت واقف في الجراج اضغط «خذ موقعي الآن».</div>' +
      '</div>' +
      '<div class="row">' +
        '<div class="field"><label>الوصول للملعب مطلوب قبل المباراة بـ (دقيقة)</label>' +
          '<input type="number" id="stBefore" value="' + (st.arriveBeforeMin) + '" min="0" max="180" step="5"></div>' +
        '<div class="field"><label>فترة السماح قبل احتساب تأخير (دقيقة)</label>' +
          '<input type="number" id="stGrace" value="' + (st.lateGraceMin) + '" min="0" max="60" step="5"></div>' +
        '<div class="field"><label>تردد إرسال الموقع من الموبايل (ثانية)</label>' +
          '<input type="number" id="stPing" value="' + (st.pingSeconds) + '" min="10" max="300" step="5">' +
          '<div class="hint">كل ما قلّ الرقم، التتبع أدق — وبطارية الموبايل بتخلص أسرع. 20–30 ثانية معقولة.</div></div>' +
      '</div>' +
      '<button class="btn pri" id="stSave">حفظ الإعدادات</button>' +
    '</div></div>';

    /* أجور الفريق */
    h += '<div class="card"><div class="card-h"><h3>أجر المباراة الافتراضي لكل وظيفة</h3></div><div class="card-b">' +
      '<p class="small muted">الأرقام دي بتتطبق على أي فرد مالوش أجر خاص في بياناته. ' +
      'منها بتتحسب مستحقات الأسبوع في شاشة «مستحقات الفريق».</p>' +
      '<div class="row">' +
      ROLES.map(function (r) {
        return '<div class="field" style="margin:0"><label>' + esc(r) + '</label>' +
          '<input type="number" min="0" step="10" data-rate="' + esc(r) + '" value="' +
          esc((st.defaultRates && st.defaultRates[r]) || '') + '" placeholder="0"></div>';
      }).join('') +
      '</div>' +
      '<div class="row" style="margin-top:4px">' +
        '<div class="field" style="margin:0"><label>الأسبوع يبدأ يوم</label><select id="stWeek">' +
          AMB.AR_DAYS.map(function (d, i) {
            return '<option value="' + i + '"' + (Number(st.weekStart) === i ? ' selected' : '') + '>' + d + '</option>';
          }).join('') + '</select>' +
          '<div class="hint">بيحدد بداية ونهاية الأسبوع في تقارير المستحقات.</div></div>' +
      '</div>' +
      '<button class="btn pri" id="ratesSave" style="margin-top:8px">حفظ الأجور</button>' +
    '</div></div>';

    /* البونص التلقائي */
    h += '<div class="card"><div class="card-h"><h3>🎁 البونص التلقائي</h3><span class="spacer"></span>' +
      (st.autoBonus ? '<span class="tag ok dot">شغّال</span>' : '<span class="tag">مقفول</span>') +
      '</div><div class="card-b">' +
      '<p class="small muted">بونص بينزل لوحده في حساب الفرد عن كل مباراة، فوق أجره العادي. ' +
      'بيظهر في مستحقات الأسبوع من غير ما تكتبه بإيدك.</p>' +
      '<label class="chk' + (st.autoBonus ? ' on' : '') + '" style="margin-bottom:12px">' +
        '<input type="checkbox" id="abOn"' + (st.autoBonus ? ' checked' : '') + '> شغّل البونص التلقائي</label>' +
      '<div id="abBox"' + (st.autoBonus ? '' : ' style="display:none"') + '>' +
        '<div class="field"><label>البونص يستحق عن</label><select id="abRule">' +
          [['done', 'كل مباراة انتهت'],
           ['attended', 'كل مباراة انتهت وسجّل فيها حضوره'],
           ['ontime', 'كل مباراة انتهت وسجّل حضوره في الميعاد']]
          .map(function (o) {
            return '<option value="' + o[0] + '"' + (st.bonusRule === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
          }).join('') + '</select>' +
          '<div class="hint" id="abHint"></div></div>' +
        '<div class="row">' +
          '<div class="field" style="margin:0"><label>البونص العام لكل مباراة (ج)</label>' +
            '<input type="number" id="abAmount" min="0" step="5" value="' + esc(st.bonusPerJob || '') + '" placeholder="50">' +
            '<div class="hint">بينطبق على أي فرد مالوش رقم خاص بوظيفته.</div></div>' +
        '</div>' +
        '<p class="small muted" style="margin:10px 0 4px">أو حدد لكل وظيفة على حدة (اللي تسيبه فاضي هياخد العام):</p>' +
        '<div class="row">' +
        ROLES.map(function (r) {
          return '<div class="field" style="margin:0"><label>' + esc(r) + '</label>' +
            '<input type="number" min="0" step="5" data-bonus="' + esc(r) + '" value="' +
            esc((st.defaultBonuses && st.defaultBonuses[r]) || '') + '" placeholder="—"></div>';
        }).join('') +
        '</div>' +
        '<div class="note" style="margin-top:12px">تقدر تستثني فرد معيّن بإنك تكتب <strong>0</strong> ' +
        'في خانة «بونص المباراة» في بياناته.</div>' +
      '</div>' +
      '<button class="btn pri" id="abSave" style="margin-top:8px">حفظ البونص</button>' +
    '</div></div>';

    /* قفل البيانات المالية */
    h += '<div class="card"><div class="card-h"><h3>🔒 قفل البيانات المالية</h3><span class="spacer"></span>' +
      (Owner.hasPin() ? '<span class="tag ok dot">مفعّل</span>' : '<span class="tag">غير مفعّل</span>') +
      '</div><div class="card-b">' +
      '<p class="small muted">لما تفعّله، شاشات <strong>التحصيل</strong> و<strong>التقارير</strong> ' +
      'وكل المبالغ في النظام هتتخفي ورا رقم سري — يعني حد يبص على الشاشة مش هيشوف إيراداتك ولا صافي الشهر.</p>' +
      '<div class="note warn"><strong>اعرف حدوده:</strong> ده بيمنع اللي يبص على الشاشة، ' +
      'مش حماية تقنية كاملة. حد فاهم في الكمبيوتر يقدر يوصل للأرقام من أدوات المتصفح. ' +
      'الحماية الحقيقية إن جهازك يكون عليه باسورد ومحدش يستخدمه غيرك.</div>' +
      (Owner.hasPin()
        ? '<div class="btn-row">' +
            '<button class="btn" id="pinChange">تغيير الرقم السري</button>' +
            '<button class="btn danger" id="pinOff">إلغاء القفل</button>' +
            (Owner.locked() ? '' : '<button class="btn acc" id="pinNow">اقفل دلوقتي</button>') +
          '</div>'
        : '<div class="row" style="max-width:420px">' +
            '<div class="field" style="margin:0"><label>رقم سري (4 أرقام أو أكتر)</label>' +
              '<input type="password" id="pinA" inputmode="numeric" placeholder="••••"></div>' +
            '<div class="field" style="margin:0"><label>تأكيد الرقم</label>' +
              '<input type="password" id="pinB" inputmode="numeric" placeholder="••••"></div>' +
          '</div><button class="btn pri" id="pinSet" style="margin-top:8px">تفعيل القفل</button>') +
      '<div id="pinMsg"></div>' +
    '</div></div>';

    /* المزامنة */
    h += '<div class="card"><div class="card-h"><h3>المزامنة اللحظية (Firebase)</h3><span class="spacer"></span>' +
      (fb ? '<span class="tag ok dot" id="fbTag">مفعّلة</span>' : '<span class="tag bad">متوقفة</span>') + '</div><div class="card-b">';

    if (!fb) {
      h += '<div class="note"><strong>ليه محتاجها؟</strong> عشان موبايل المسعف يبعت الموقع لجهازك لحظة بلحظة، ' +
        'وعشان الجدول يبقى واحد على كل الأجهزة. من غيرها النظام شغال على الجهاز ده بس.<br><br>' +
        '<strong>مجانية تماماً</strong> للحجم بتاعك — 3 عربيات بتستهلك أقل من 1% من الحد المجاني.</div>' +
      '<button class="btn acc" id="fbGuide">📖 اعرض خطوات الإعداد (10 دقايق)</button>';
    } else {
      h += '<div class="row">' +
        '<div><div class="small muted">قاعدة البيانات</div><div class="mono small">' + esc(fb.databaseURL) + '</div></div>' +
        '<div><div class="small muted">الحالة</div><div id="fbState">' + esc(syncLabel(Sync.status)) + '</div></div>' +
      '</div><div class="btn-row" style="margin-top:12px">' +
        '<button class="btn" id="fbTest">اختبار الاتصال</button>' +
        '<button class="btn" id="fbEdit">تعديل البيانات</button>' +
        '<button class="btn danger" id="fbOff">إيقاف المزامنة</button>' +
      '</div>';
    }
    h += '</div></div>';

    /* رابط المسعفين */
    h += '<div class="card"><div class="card-h"><h3>رابط صفحة المسعفين</h3></div><div class="card-b">' +
      '<p class="small muted">دي الصفحة اللي المسعف بيفتحها على موبايله عشان يسجل الحضور ويبعت الموقع.</p>' +
      '<button class="btn acc" id="stDrvLink">📱 اعرض الرابط ومشاركته</button></div></div>';

    /* النسخ الاحتياطي */
    h += '<div class="card"><div class="card-h"><h3>النسخ الاحتياطي والبيانات</h3></div><div class="card-b">' +
      '<div class="note warn">بيانات النظام محفوظة في متصفح الجهاز ده. لو مسحت بيانات المتصفح، هتضيع. ' +
      '<strong>اعمل نسخة احتياطية كل أسبوع</strong> واحتفظ بالملف في مكان آمن.</div>' +
      '<div class="btn-row">' +
        '<button class="btn pri" id="bkExport">⤓ تنزيل نسخة احتياطية</button>' +
        '<button class="btn" id="bkImportMerge">⤒ استرجاع (دمج)</button>' +
        '<button class="btn" id="bkImportRepl">⤒ استرجاع (استبدال كامل)</button>' +
        '<button class="btn danger" id="bkWipe">🗑 مسح كل البيانات</button>' +
      '</div>' +
      '<div class="small muted" style="margin-top:12px">' +
        AMB.COLLECTIONS.map(function (c) { return colLabel(c) + ': <strong>' + S.all(c).length + '</strong>'; }).join(' · ') +
      '</div>' +
    '</div></div>';

    host.innerHTML = h;

    /* الجراج */
    var gloc = { lat: st.garage.lat, lng: st.garage.lng, radius: st.garage.radius || 200 };
    function drawG() {
      var box = host.querySelector('#gBox');
      box.innerHTML = gloc.lat != null
        ? '<span class="tag ok dot">محدد</span><span class="mono">' + gloc.lat.toFixed(6) + ', ' + gloc.lng.toFixed(6) + '</span>' +
          '<span class="muted">نطاق ' + gloc.radius + ' م</span><span style="flex:1"></span><button class="btn sm" id="gPick">تعديل</button>'
        : '<span class="tag bad">غير محدد</span><span class="muted">مطلوب لحساب وقت الخروج والعودة</span>' +
          '<span style="flex:1"></span><button class="btn sm acc" id="gPick">حدد الجراج</button>';
      box.querySelector('#gPick').onclick = function () {
        UI.pickLocation({ title: 'موقع الجراج', label: 'الجراج', lat: gloc.lat, lng: gloc.lng, radius: gloc.radius,
          others: S.all('venues').filter(function (x) { return x.lat != null; })
        }).then(function (r) { if (r) { gloc = r; drawG(); AMB.toast('اضغط «حفظ الإعدادات» عشان يتثبّت', 'warn'); } });
      };
    }
    drawG();

    host.querySelector('#stSave').onclick = function () {
      st.company = host.querySelector('#stCo').value.trim() || 'شركة الإسعاف';
      st.garage = { name: host.querySelector('#stGName').value.trim() || 'الجراج',
                    lat: gloc.lat, lng: gloc.lng, radius: gloc.radius };
      st.arriveBeforeMin = Number(host.querySelector('#stBefore').value) || 0;
      st.lateGraceMin = Number(host.querySelector('#stGrace').value) || 0;
      st.pingSeconds = Math.max(10, Number(host.querySelector('#stPing').value) || 20);
      S.saveSettings(st);
      document.getElementById('coName').textContent = st.company;
      AMB.toast('تم حفظ الإعدادات', 'ok');
    };

    /* --- أجور الفريق --- */
    host.querySelector('#ratesSave').onclick = function () {
      var rates = {};
      host.querySelectorAll('[data-rate]').forEach(function (i) {
        var v = Number(i.value) || 0;
        if (v > 0) rates[i.dataset.rate] = v;
      });
      st.defaultRates = rates;
      st.weekStart = Number(host.querySelector('#stWeek').value);
      S.saveSettings(st);
      rollWeek = null;
      AMB.toast('تم حفظ الأجور', 'ok');
    };

    /* --- البونص التلقائي --- */
    var abOn = host.querySelector('#abOn');
    var abRule = host.querySelector('#abRule');
    function abHint() {
      var n = { done: 'أبسط شكل — أي مباراة اتقفلت بتديله بونص، حتى لو ما سجّلش حضور.',
                attended: 'البونص مربوط بإنه فعلاً كان هناك وسجّل بالـ GPS.',
                ontime: 'أقوى شكل — البونص بيروح منه لو اتأخر عن الميعاد.' }[abRule.value];
      host.querySelector('#abHint').textContent = n;
    }
    abOn.onchange = function () {
      host.querySelector('#abBox').style.display = this.checked ? '' : 'none';
      this.closest('.chk').classList.toggle('on', this.checked);
    };
    abRule.onchange = abHint;
    abHint();

    host.querySelector('#abSave').onclick = function () {
      st.autoBonus = abOn.checked;
      st.bonusRule = abRule.value;
      st.bonusPerJob = Number(host.querySelector('#abAmount').value) || 0;
      var bs = {};
      host.querySelectorAll('[data-bonus]').forEach(function (i) {
        var v = Number(i.value) || 0;
        if (v > 0) bs[i.dataset.bonus] = v;
      });
      st.defaultBonuses = bs;
      S.saveSettings(st);
      if (st.autoBonus && !st.bonusPerJob && !Object.keys(bs).length) {
        AMB.toast('شغّلت البونص بس ما حددتش قيمته — اكتب رقم', 'warn', 6000);
      } else {
        AMB.toast(st.autoBonus ? 'البونص التلقائي شغّال ✓' : 'تم إيقاف البونص التلقائي', 'ok');
      }
      render();
    };

    /* --- قفل البيانات المالية --- */
    var pinSet = host.querySelector('#pinSet');
    if (pinSet) pinSet.onclick = function () {
      var a = host.querySelector('#pinA').value.trim();
      var b = host.querySelector('#pinB').value.trim();
      var msg = host.querySelector('#pinMsg');
      if (a.length < 4) { msg.innerHTML = '<div class="note bad">الرقم لازم يكون 4 خانات على الأقل</div>'; return; }
      if (a !== b) { msg.innerHTML = '<div class="note bad">الرقمين مش زي بعض</div>'; return; }
      Owner.setPin(a);
      try { sessionStorage.setItem('amb_owner', '1'); } catch (e) { }   // إنت فاتح دلوقتي
      render();
      AMB.toast('تم تفعيل القفل — هيشتغل أول ما تقفل المتصفح وتفتحه تاني', 'ok', 6000);
    };
    var pinChange = host.querySelector('#pinChange');
    if (pinChange) pinChange.onclick = function () {
      Owner.unlock().then(function (ok) {
        if (!ok && Owner.locked()) return;
        UI.prompt('الرقم السري الجديد (4 خانات على الأقل)', { title: 'تغيير الرقم', type: 'password' })
          .then(function (v) {
            if (!v || v.trim().length < 4) { if (v !== null) AMB.toast('الرقم قصير', 'error'); return; }
            Owner.setPin(v.trim());
            AMB.toast('تم تغيير الرقم السري', 'ok');
          });
      });
    };
    var pinOff = host.querySelector('#pinOff');
    if (pinOff) pinOff.onclick = function () {
      Owner.unlock().then(function (ok) {
        if (!ok && Owner.locked()) return;
        UI.confirm('إلغاء قفل البيانات المالية؟', { danger: true, detail: 'كل الأرقام هتبقى ظاهرة لأي حد يفتح النظام.' })
          .then(function (yes) {
            if (!yes) return;
            Owner.setPin('');
            render(); AMB.toast('تم إلغاء القفل');
          });
      });
    };
    var pinNow = host.querySelector('#pinNow');
    if (pinNow) pinNow.onclick = function () { Owner.lock(); };

    var g = host.querySelector('#fbGuide'); if (g) g.onclick = firebaseWizard;
    var e = host.querySelector('#fbEdit'); if (e) e.onclick = firebaseWizard;
    var o = host.querySelector('#fbOff');
    if (o) o.onclick = function () {
      UI.confirm('إيقاف المزامنة؟', { danger: true, detail: 'البيانات المحلية هتفضل موجودة، بس مش هتتحدث من الأجهزة التانية.' })
        .then(function (ok) { if (ok) { Sync.disconnect(); Sync.setConfig(null); render(); AMB.toast('تم إيقاف المزامنة'); } });
    };
    var tst = host.querySelector('#fbTest');
    if (tst) tst.onclick = function () {
      var b = this; b.disabled = true; b.textContent = 'جاري الاختبار...';
      Sync.ensureToken().then(function () { return Sync.pullOnce('vehicles'); })
        .then(function () { AMB.toast('الاتصال شغال ✓', 'ok'); })
        .catch(function (err) { AMB.toast('فشل الاتصال: ' + err.message, 'error'); })
        .finally(function () { b.disabled = false; b.textContent = 'اختبار الاتصال'; });
    };

    host.querySelector('#stDrvLink').onclick = function () { showDriverLink(null); };

    host.querySelector('#bkExport').onclick = function () {
      UI.downloadJSON('نسخة-احتياطية-' + AMB.today() + '.json', S.exportAll());
      AMB.toast('تم تنزيل النسخة — احفظها في مكان آمن', 'ok');
    };
    host.querySelector('#bkImportMerge').onclick = function () { doImport('merge'); };
    host.querySelector('#bkImportRepl').onclick = function () { doImport('replace'); };
    host.querySelector('#bkWipe').onclick = function () {
      UI.confirm('مسح كل بيانات النظام من الجهاز ده؟', {
        danger: true, yes: 'نعم، امسح الكل',
        detail: 'كل المهام والحضور والصيانة والتفويل هتتمسح. لو معندكش نسخة احتياطية، مفيش رجوع.'
      }).then(function (ok) {
        if (!ok) return;
        UI.prompt('اكتب كلمة «مسح» للتأكيد', { title: 'تأكيد أخير' }).then(function (v) {
          if (v && v.trim() === 'مسح') { S.wipe(); AMB.seedIfEmpty(true); render(); AMB.toast('تم مسح البيانات'); }
          else AMB.toast('تم الإلغاء');
        });
      });
    };

    function doImport(mode) {
      UI.pickFile('.json,application/json').then(function (f) {
        if (!f) return;
        var fr = new FileReader();
        fr.onload = function () {
          try {
            var data = JSON.parse(fr.result);
            if (mode === 'replace') {
              UI.confirm('استبدال كل البيانات الحالية بمحتوى الملف؟', { danger: true }).then(function (ok) {
                if (!ok) return;
                var n = S.importAll(data, 'replace');
                render(); AMB.toast('تم استرجاع ' + n + ' سجل', 'ok');
              });
            } else {
              var n = S.importAll(data, 'merge');
              render(); AMB.toast('تم دمج ' + n + ' سجل جديد', 'ok');
            }
          } catch (err) { AMB.toast('الملف غير صالح: ' + err.message, 'error'); }
        };
        fr.readAsText(f);
      });
    }
  }

  function colLabel(c) {
    return { vehicles: 'سيارات', staff: 'أفراد', venues: 'ملاعب', assignments: 'مهام',
             attendance: 'حضور', maintenance: 'صيانة', fuel: 'تفويل', incidents: 'بلاغات', tracks: 'نقاط مسار' }[c] || c;
  }

  function syncLabel(s) {
    return { off: 'متوقفة', connecting: 'جاري الاتصال...', live: '◉ مباشر', error: 'خطأ في الاتصال' }[s] || s;
  }

  /* ---------- معالج إعداد Firebase ---------- */

  function firebaseWizard() {
    var cur = Sync.config() || {};
    var body =
      '<div class="note"><strong>هتعمل الخطوات دي مرة واحدة بس.</strong> كلها مجانية ومش محتاجة أي بطاقة بنكية.</div>' +
      '<ol style="padding-inline-start:20px;line-height:2;font-size:.9rem">' +
        '<li>افتح <a href="https://console.firebase.google.com" target="_blank" rel="noopener">console.firebase.google.com</a> وسجّل دخول بحساب جوجل.</li>' +
        '<li>اضغط <strong>Add project</strong> ← اكتب اسم (مثلاً <span class="mono">ambulance</span>) ← <strong>Continue</strong> ← اقفل Google Analytics ← <strong>Create</strong>.</li>' +
        '<li>من القايمة الجانبية: <strong>Build ← Realtime Database ← Create Database</strong>.<br>' +
            'اختار الموقع <span class="mono">europe-west1</span> ← <strong>Start in locked mode</strong> ← Enable.</li>' +
        '<li>في تبويب <strong>Rules</strong>، امسح اللي مكتوب والصق ده بالظبط ← <strong>Publish</strong>:' +
          '<pre class="mono" style="background:var(--panel2);padding:10px;border-radius:8px;font-size:.75rem;direction:ltr;text-align:left;overflow:auto;border:1px solid var(--line)">' +
'{\n  "rules": {\n    "fleet": {\n      ".read": "auth != null",\n      ".write": "auth != null",\n      "$col": {\n        "$id": {\n          ".validate": "newData.hasChild(\'_id\')"\n        }\n      }\n    }\n  }\n}</pre></li>' +
        '<li>من القايمة: <strong>Build ← Authentication ← Get started ← Sign-in method ← Anonymous ← Enable ← Save</strong>.</li>' +
        '<li>اضغط على ⚙ جنب <strong>Project Overview</strong> ← <strong>Project settings</strong>. تحت <strong>Your apps</strong> اضغط أيقونة الويب <span class="mono">&lt;/&gt;</span> ← اكتب أي اسم ← <strong>Register app</strong>.</li>' +
        '<li>هيظهرلك كود فيه <span class="mono">apiKey</span> و <span class="mono">databaseURL</span> — انسخهم والصقهم تحت.</li>' +
      '</ol>' +
      '<div class="field"><label>databaseURL</label>' +
        '<input type="text" id="fbUrl" class="mono" dir="ltr" value="' + esc(cur.databaseURL || '') + '" placeholder="https://xxxx-default-rtdb.europe-west1.firebasedatabase.app"></div>' +
      '<div class="field"><label>apiKey</label>' +
        '<input type="text" id="fbKey" class="mono" dir="ltr" value="' + esc(cur.apiKey || '') + '" placeholder="AIzaSy..."></div>' +
      '<div id="fbMsg"></div>';

    var m = UI.modal({
      title: 'إعداد المزامنة اللحظية', size: 'wide', body: body,
      buttons: [
        { text: 'حفظ وتفعيل', cls: 'pri', keepOpen: true, onClick: function (api) {
            var url = api.body.querySelector('#fbUrl').value.trim().replace(/\/+$/, '');
            var key = api.body.querySelector('#fbKey').value.trim();
            if (!/^https:\/\/.+firebase(io|database)/.test(url)) {
              api.body.querySelector('#fbMsg').innerHTML = '<div class="note bad">الرابط شكله مش صح — لازم يبدأ بـ https ويحتوي على firebasedatabase أو firebaseio</div>';
              return false;
            }
            if (!/^AIza/.test(key)) {
              api.body.querySelector('#fbMsg').innerHTML = '<div class="note bad">الـ apiKey شكله مش صح — عادةً بيبدأ بـ AIza</div>';
              return false;
            }
            api.body.querySelector('#fbMsg').innerHTML = '<div class="note">جاري الاختبار...</div>';
            Sync.disconnect();
            Sync.token = null; Sync.refreshToken = null;
            Sync.setConfig({ databaseURL: url, apiKey: key });
            Sync.connect().then(function (ok) {
              if (ok) {
                api.body.querySelector('#fbMsg').innerHTML = '<div class="note ok">✓ تم الاتصال بنجاح! جاري رفع البيانات الحالية...</div>';
                pushEverything();
                setTimeout(function () { api.close(); render(); AMB.toast('المزامنة اشتغلت ✓', 'ok'); }, 1400);
              } else {
                api.body.querySelector('#fbMsg').innerHTML = '<div class="note bad">فشل الاتصال: ' + esc(Sync.statusMsg || 'راجع الخطوات') +
                  '<br><span class="small">أشهر سببين: نسيت تفعّل <strong>Anonymous</strong> في Authentication، أو الـ Rules مش متحفوظة.</span></div>';
              }
            });
            return false;
          } },
        { spacer: true }, { text: 'إغلاق' }
      ]
    });
  }

  /* رفع كل البيانات الحالية للسحابة (أول مرة) */
  function pushEverything() {
    AMB.COLLECTIONS.forEach(function (c) {
      S.raw(c).forEach(function (r) { Sync.push(c, r); });
    });
  }

  /* ---------- رابط المسعفين ---------- */

  function showDriverLink(staffId) {
    var base = location.href.replace(/[^/]*(\?.*)?(#.*)?$/, '') + 'driver.html';
    var fb = Sync.config();
    var params = [];
    if (fb) {
      try { params.push('c=' + encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(fb)))))); } catch (e) { }
    }
    if (staffId) params.push('s=' + encodeURIComponent(staffId));
    var url = base + (params.length ? '#' + params.join('&') : '');
    var isFile = location.protocol === 'file:';

    var body = '';
    if (isFile) {
      body += '<div class="note warn"><strong>مهم:</strong> إنت فاتح النظام من ملف على الجهاز مباشرة. ' +
        'الرابط ده مش هيفتح على موبايل المسعف، ومتصفحات الموبايل بترفض تشغيل الـ GPS إلا من موقع بـ <span class="mono">https</span>.<br><br>' +
        'الحل المجاني: ارفع الملفات على <strong>Firebase Hosting</strong> (نفس الحساب) أو <strong>Netlify Drop</strong> — ' +
        'وقتها هيبقى عندك رابط https حقيقي تبعته للمسعفين. الخطوات في ملف <span class="mono">دليل التشغيل</span> جنب النظام.</div>';
    }
    if (!fb) {
      body += '<div class="note bad">المزامنة مش مفعّلة — الرابط هيفتح بس البيانات مش هتوصلك. فعّل المزامنة الأول من الإعدادات.</div>';
    }

    body += '<div class="field"><label>الرابط' + (staffId ? ' — ' + esc(M.staffName(staffId)) : ' العام') + '</label>' +
      '<input type="text" id="_dl" class="mono" dir="ltr" value="' + esc(url) + '" readonly style="font-size:.75rem"></div>' +
      '<div class="note">الرابط ده فيه إعدادات الاتصال جوّاه — المسعف يفتحه مرة واحدة ويحفظه على الشاشة الرئيسية للموبايل، ' +
      'وبعد كده يفتحه زي أي تطبيق.</div>';

    if (!staffId) {
      var staff = S.all('staff').sort(byName);
      if (staff.length) {
        body += '<div class="field"><label>أو ابعت رابط مخصص لفرد معين (بيفتح على اسمه على طول)</label>' +
          '<div class="checks">' + staff.map(function (s) {
            return '<button class="btn sm" data-slink="' + s._id + '">' + esc(s.name) + '</button>';
          }).join('') + '</div></div>';
      }
    }

    var m = UI.modal({
      title: '📱 رابط صفحة المسعفين', size: 'wide', body: body,
      buttons: [
        { text: '📋 نسخ الرابط', cls: 'pri', keepOpen: true, onClick: function (api) {
            var inp = api.body.querySelector('#_dl');
            inp.select(); inp.setSelectionRange(0, 99999);
            var done = false;
            if (navigator.clipboard) {
              navigator.clipboard.writeText(inp.value).then(function () { AMB.toast('تم نسخ الرابط', 'ok'); }).catch(fallback);
            } else fallback();
            function fallback() { try { document.execCommand('copy'); AMB.toast('تم نسخ الرابط', 'ok'); } catch (e) { AMB.toast('انسخه يدوياً', 'warn'); } }
            return false;
          } },
        { text: '💬 إرسال بواتساب', keepOpen: true, onClick: function (api) {
            var txt = 'رابط تسجيل الحضور — افتحه من الموبايل واحفظه على الشاشة الرئيسية:\n' + api.body.querySelector('#_dl').value;
            window.open('https://wa.me/?text=' + encodeURIComponent(txt), '_blank', 'noopener');
            return false;
          } },
        { text: 'فتح الصفحة هنا', keepOpen: true, onClick: function (api) {
            window.open(api.body.querySelector('#_dl').value, '_blank', 'noopener'); return false;
          } },
        { spacer: true }, { text: 'إغلاق' }
      ]
    });

    m.body.querySelectorAll('[data-slink]').forEach(function (b) {
      b.onclick = function () { m.close(); setTimeout(function () { showDriverLink(b.dataset.slink); }, 100); };
    });
  }

  /* ============================================================
     التشغيل
     ============================================================ */

  function byName(a, b) { return String(a.name || '').localeCompare(String(b.name || ''), 'ar'); }

  /* ترتيب الأندية بالأولوية اليدوية — اللي مالوش ترتيب ينزل الآخر بالاسم */
  function byOrder(a, b) {
    var ao = (a.order == null) ? 99999 : Number(a.order);
    var bo = (b.order == null) ? 99999 : Number(b.order);
    if (ao !== bo) return ao - bo;
    return byName(a, b);
  }

  /* يرقّم الأندية 0،1،2... حسب ترتيبها الحالي — بيتنادى قبل أي تحريك */
  function normalizeVenueOrder() {
    var list = S.all('venues').sort(byOrder);
    var changed = [];
    list.forEach(function (v, i) { if (Number(v.order) !== i) { v.order = i; changed.push(v); } });
    if (changed.length) S.putBatch('venues', changed);
    return list;
  }

  /* تحريك نادي خطوة لفوق/لتحت، أو لأول/آخر القائمة */
  function moveVenue(id, dir) {
    var list = normalizeVenueOrder();
    var from = -1;
    for (var i = 0; i < list.length; i++) if (list[i]._id === id) { from = i; break; }
    if (from < 0) return;

    var to;
    if (dir === 'top') to = 0;
    else if (dir === 'bottom') to = list.length - 1;
    else to = from + dir;
    if (to < 0 || to >= list.length || to === from) return;

    list.splice(to, 0, list.splice(from, 1)[0]);
    var changed = [];
    list.forEach(function (v, i) { if (Number(v.order) !== i) { v.order = i; changed.push(v); } });
    if (changed.length) S.putBatch('venues', changed);
  }

  /* إفلات نادي في موضع نادٍ آخر (السحب والإفلات) */
  function dropVenue(dragId, targetId) {
    if (dragId === targetId) return;
    var list = normalizeVenueOrder();
    var from = -1, to = -1;
    list.forEach(function (v, i) {
      if (v._id === dragId) from = i;
      if (v._id === targetId) to = i;
    });
    if (from < 0 || to < 0) return;
    list.splice(to, 0, list.splice(from, 1)[0]);
    var changed = [];
    list.forEach(function (v, i) { if (Number(v.order) !== i) { v.order = i; changed.push(v); } });
    if (changed.length) S.putBatch('venues', changed);
  }

  function initTheme() {
    var t = localStorage.getItem('amb_theme');
    if (t) document.documentElement.setAttribute('data-theme', t);
    document.getElementById('btnTheme').onclick = function () {
      var cur = document.documentElement.getAttribute('data-theme');
      var next = cur === 'dark' ? 'light' : cur === 'light' ? '' : 'dark';
      if (next) { document.documentElement.setAttribute('data-theme', next); localStorage.setItem('amb_theme', next); }
      else { document.documentElement.removeAttribute('data-theme'); localStorage.removeItem('amb_theme'); }
    };
  }

  function initSyncUI() {
    var pill = document.getElementById('syncPill');
    var txt = document.getElementById('syncTxt');
    function upd(s, msg) {
      pill.dataset.s = s;
      var q = Sync.pending ? Sync.pending() : 0;
      txt.textContent = q ? '↻ بيرفع ' + q + '...'
                      : s === 'live' ? 'المزامنة مباشرة'
                      : s === 'connecting' ? 'جاري الاتصال...'
                      : s === 'error' ? '⚠ الجهاز ده غير متصل' : 'المزامنة متوقفة';
      var fs = document.getElementById('fbState');
      if (fs) fs.textContent = syncLabel(s);

      /* لافتة كبيرة فوق الشاشة — المؤشر الصغير مش كفاية لتحذير بالخطورة دي.
         لو الجهاز مش واصل، أي شغل عليه بيفضل محلي والباقي مش هيشوفه. */
      var b = document.getElementById('offlineBanner');
      var pend = Sync.pending ? Sync.pending() : 0;
      var stuck = Sync.stuckFor ? Sync.stuckFor() : 0;
      /* مانزعجش المستخدم من أول تأخيرة — الشبكة المتقطعة بتنجح من التانية.
         التحذير بيظهر بس لو السجل فضل عالق أكتر من دقيقتين. */
      var reallyStuck = pend && stuck > 120;
      if (s === 'off' || reallyStuck) {
        if (!b) {
          b = document.createElement('div');
          b.id = 'offlineBanner';
          b.className = 'offline-banner';
          document.body.insertBefore(b, document.body.firstChild);
        }
        b.innerHTML = pend
          ? '<strong>⚠ ' + pend + ' سجل عالق من ' + Math.round(stuck / 60) + ' دقيقة</strong>' +
            '<span>النظام بيعيد المحاولة كل ١٥ ثانية لوحده وشغلك محفوظ — ' +
            'سيب الصفحة مفتوحة. لو فضل كده، جرّب شبكة تانية.</span>' +
            '<button type="button" id="retryNow">أعد المحاولة دلوقتي</button>'
          : '<strong>⚠ الجهاز ده مش متصل بقاعدة البيانات</strong>' +
            '<span>اللي تدخله هنا هيفضل على الجهاز ده لوحده — الفريق مش هيشوفه. ' +
            'اشتغل من جهاز تاني، أو جرّب شبكة تانية.</span>' +
            '<a href="nettest.html" target="_blank" rel="noopener">افحص الاتصال</a>';
        var rb = b.querySelector('#retryNow');
        if (rb) rb.onclick = function () {
          rb.textContent = 'بيحاول...'; rb.disabled = true;
          Sync.flush();
          setTimeout(function () { upd(Sync.status); }, 6000);
        };
      } else if (b) {
        b.remove();
      }
    }
    Sync.onStatus(upd);
    upd(Sync.status);
    pill.onclick = function () { go('settings'); };
  }

  document.addEventListener('DOMContentLoaded', function () {
    AMB.seedIfEmpty();
    S.pruneTracks(10);
    var st = S.settings();
    document.getElementById('coName').textContent = st.company;
    document.title = st.company + ' — نظام إدارة الإسعاف';

    initTheme();
    initSyncUI();

    document.querySelectorAll('#nav button').forEach(function (b) {
      b.onclick = function () { go(b.dataset.v); };
    });
    document.getElementById('btnDriverLink').onclick = function () { showDriverLink(null); };
    document.getElementById('btnLock').onclick = function () {
      if (Owner.locked()) Owner.unlock().then(function (ok) { if (ok) render(); });
      else Owner.lock();
    };

    S.onChange(function () { if (current !== 'live') render(); else updateBadges(); });

    if (Sync.config()) Sync.connect();

    var h = (location.hash || '').replace('#', '');
    go(VIEWS[h] ? h : 'dash');
  });

})();
