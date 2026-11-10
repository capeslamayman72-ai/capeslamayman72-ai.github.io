/* ============================================================
   واجهة الدخول — اسم مستخدم ورقم سري من 4 أرقام لكل مدير
   ------------------------------------------------------------
   الحسابات متخزنة في الإعدادات (settings.admins) وبتتزامن مع كل الأجهزة.
   الرقم السري مش متخزن — متخزن بصمته (SHA-256 مع ملح لكل حساب).
   «افتكرني» بيحفظ على الجهاز البصمة بس، فلو الرقم اتغير الدخول التلقائي بيقف.

   حدودها: دي بوابة للشاشة. البيانات نفسها لسه محمية بقواعد Firebase بس،
   فحد فاهم يقدر يوصلها من أدوات المتصفح. الحماية الكاملة محتاجة حسابات
   Firebase Authentication وقواعد بتفرّق بين المدير والمسعف.
   ============================================================ */
(function (global) {
  'use strict';

  var S = AMB.Store, Sync = AMB.Sync, esc = AMB.esc;
  var REMEMBER = 'amb_login';       /* localStorage: {id, h} */
  var SESSION = 'amb_login_s';      /* sessionStorage: id */
  var MAX_TRIES = 5, LOCK_MS = 30000;
  var tries = 0, lockedUntil = 0;
  var gate = null, me = null;

  function admins() { return (S.settings().admins || []).filter(function (a) { return a && a.id && a.pinH; }); }
  function norm(s) { return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase(); }
  function findUser(name) {
    var n = norm(name);
    return admins().filter(function (a) { return norm(a.user) === n; })[0] || null;
  }
  function byId(id) { return admins().filter(function (a) { return a.id === id; })[0] || null; }

  function hex(buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function hashPin(salt, pin) {
    var txt = 'amb|' + salt + '|' + pin;
    if (global.crypto && crypto.subtle) {
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt)).then(hex);
    }
    /* احتياطي لو المتصفح من غير crypto.subtle (صفحة مش https) */
    var h = 5381;
    for (var i = 0; i < txt.length; i++) h = ((h * 33) ^ txt.charCodeAt(i)) >>> 0;
    return Promise.resolve('x' + h.toString(16));
  }
  function newSalt() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
  function validPin(p) { return /^\d{4}$/.test(p); }

  function saveAdmins(list) {
    var st = S.settings();
    st.admins = list;
    S.saveSettings(st);
  }

  /* ---------------- الدخول والخروج ---------------- */

  function enter(a, remember) {
    me = a;
    global.AMB_USER = a.user;
    try { sessionStorage.setItem(SESSION, a.id); } catch (e) { }
    if (remember) { try { localStorage.setItem(REMEMBER, JSON.stringify({ id: a.id, h: a.pinH })); } catch (e) { } }
    document.body.classList.remove('gated');
    if (gate) {
      gate.classList.add('lg-out');
      var g = gate; gate = null;
      setTimeout(function () { g.remove(); }, 650);
    }
    showUserChip();
  }

  function logout() {
    try { sessionStorage.removeItem(SESSION); localStorage.removeItem(REMEMBER); } catch (e) { }
    global.AMB_USER = null;
    location.reload();
  }

  /* دخول من غير ما يكتب حاجة: الجلسة المفتوحة أو «افتكرني» */
  function silentLogin() {
    var id = null, h = null;
    try { id = sessionStorage.getItem(SESSION); } catch (e) { }
    if (id && byId(id)) return byId(id);
    try { var r = JSON.parse(localStorage.getItem(REMEMBER) || 'null'); if (r) { id = r.id; h = r.h; } } catch (e) { }
    var a = id && byId(id);
    return a && h && a.pinH === h ? a : null;
  }

  function showUserChip() {
    var bar = document.querySelector('.topbar');
    if (!bar || !me || document.getElementById('userChip')) return;
    var b = document.createElement('button');
    b.className = 'btn sm user-chip'; b.id = 'userChip'; b.type = 'button';
    b.title = 'تسجيل الخروج';
    b.innerHTML = '👤 ' + esc(me.user) + ' <span class="muted">· خروج</span>';
    b.onclick = function () {
      UI.confirm('تسجيل الخروج من ' + me.user + '؟', { detail: 'الجهاز ده هينسى الرقم السري، والدخول الجاي هيطلب الاسم والرقم.' })
        .then(function (ok) { if (ok) logout(); });
    };
    bar.appendChild(b);
  }

  /* ---------------- الواجهة ---------------- */

  /* عربية إسعاف مرسومة (SVG) — بتتحرك على الطريق تحت وأنوارها بتلمع */
  var AMB_SVG =
    '<svg viewBox="0 0 260 120" class="lg-van" aria-hidden="true">' +
      '<rect x="8" y="22" width="150" height="70" rx="6" fill="#f7f7f5"/>' +
      '<path d="M158 40 h46 l34 26 v26 h-80 z" fill="#f2f2ef"/>' +
      '<path d="M166 46 h34 l24 20 h-58 z" fill="#28394d" opacity=".9"/>' +
      '<rect x="8" y="64" width="230" height="9" fill="#c1121f"/>' +
      '<rect x="8" y="74" width="230" height="4" fill="#f4c20d"/>' +
      '<rect x="58" y="32" width="26" height="26" rx="3" fill="#c1121f"/>' +
      '<rect x="67" y="35" width="8" height="20" fill="#fff"/><rect x="61" y="41" width="20" height="8" fill="#fff"/>' +
      '<rect x="20" y="32" width="26" height="22" rx="2" fill="#28394d" opacity=".85"/>' +
      '<rect x="232" y="76" width="10" height="7" rx="2" fill="#ffd166"/>' +
      '<rect x="130" y="12" width="44" height="10" rx="3" fill="#333"/>' +
      '<rect x="132" y="13" width="19" height="8" rx="2" class="lb-red"/>' +
      '<rect x="153" y="13" width="19" height="8" rx="2" class="lb-blue"/>' +
      '<g class="lg-wheel" style="transform-origin:58px 94px"><circle cx="58" cy="94" r="15" fill="#222"/><circle cx="58" cy="94" r="7" fill="#aaa"/><rect x="56" y="80" width="4" height="28" fill="#555"/></g>' +
      '<g class="lg-wheel" style="transform-origin:200px 94px"><circle cx="200" cy="94" r="15" fill="#222"/><circle cx="200" cy="94" r="7" fill="#aaa"/><rect x="198" y="80" width="4" height="28" fill="#555"/></g>' +
    '</svg>';

  function buildGate() {
    var st = S.settings();
    gate = document.createElement('div');
    gate.id = 'loginGate';
    gate.className = 'lg';
    gate.innerHTML =
      '<div class="lg-bg"><span class="lg-flash bar"></span><span class="lg-flash front"></span>' +
        '<span class="lg-flash side"></span><span class="lg-flash rear"></span></div>' +
      '<div class="lg-light lg-red"></div><div class="lg-light lg-blue"></div>' +
      '<div class="lg-bar"></div>' +
      /* صورة إسعاف حقيقية من الجنب (img/ambulance-side.png) — والرسمة احتياطي لو الصورة مش موجودة */
      '<div class="lg-road"><div class="lg-drive"><img class="lg-photo" src="img/ambulance-side.png" alt="">' +
        '<span class="lg-siren"></span></div></div>' +
      '<div class="lg-card" id="lgCard"><div class="lg-logo">✚</div>' +
        '<h1>' + esc(st.company || 'نظام الإسعاف') + '</h1>' +
        '<div class="lg-sub">دخول المديرين</div>' +
        '<div id="lgBody"><div class="lg-wait">⏳ جاري الاتصال بالمركز...</div></div>' +
      '</div>';
    var ph = gate.querySelector('.lg-photo');
    /* مفيش صورة جنب حقيقية؟ ما نعرضش رسمة كرتون — الأنوار على الصورة كفاية */
    ph.onerror = function () { var r = gate && gate.querySelector('.lg-road'); if (r) r.remove(); };
    document.body.appendChild(gate);
  }

  function err(msg) {
    var e = gate && gate.querySelector('#lgErr');
    if (e) e.textContent = msg || '';
    if (msg) {
      var c = gate.querySelector('#lgCard');
      c.classList.remove('lg-shake'); void c.offsetWidth; c.classList.add('lg-shake');
    }
  }

  function drawLogin() {
    var body = gate.querySelector('#lgBody');
    body.innerHTML =
      '<form id="lgForm" autocomplete="on">' +
        '<label for="lgUser">اسم المستخدم</label>' +
        '<input id="lgUser" name="username" autocomplete="username" required>' +
        '<label for="lgPin">الرقم السري</label>' +
        '<input id="lgPin" name="password" type="password" inputmode="numeric" pattern="\\d{4}" maxlength="4" ' +
          'autocomplete="current-password" placeholder="• • • •" class="lg-pin" required>' +
        '<label class="lg-rem"><input type="checkbox" id="lgRem" checked> افتكرني على الجهاز ده</label>' +
        '<button type="submit" class="lg-btn">دخول</button>' +
        '<div id="lgErr" class="lg-err"></div>' +
      '</form>';
    var f = body.querySelector('#lgForm'), u = body.querySelector('#lgUser'), p = body.querySelector('#lgPin');
    p.addEventListener('input', function () {
      p.value = p.value.replace(/\D/g, '').slice(0, 4);
      if (p.value.length === 4 && u.value.trim()) f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event('submit'));
    });
    f.onsubmit = function (e) {
      e.preventDefault();
      if (Date.now() < lockedUntil) { err('محاولات كتير — استنى ' + Math.ceil((lockedUntil - Date.now()) / 1000) + ' ثانية'); return; }
      var a = findUser(u.value), pin = p.value;
      if (!validPin(pin)) { err('الرقم السري 4 أرقام'); return; }
      if (!a) { fail(); return; }
      hashPin(a.salt, pin).then(function (h) {
        if (h === a.pinH) { tries = 0; enter(a, body.querySelector('#lgRem').checked); }
        else fail();
      });
      function fail() {
        tries++; p.value = ''; p.focus();
        if (tries >= MAX_TRIES) { lockedUntil = Date.now() + LOCK_MS; tries = 0; err('محاولات كتير غلط — استنى 30 ثانية'); }
        else err('الاسم أو الرقم السري غلط');
      }
    };
    (u.value ? p : u).focus();
  }

  /* أول مرة خالص: مفيش ولا حساب — اللي بيفتح بيعمل حساب المالك */
  function drawFirst() {
    var body = gate.querySelector('#lgBody');
    body.innerHTML =
      '<div class="lg-note">أول مرة — اعمل حساب المدير الرئيسي (المالك). هو اللي يقدر يضيف باقي المديرين من الإعدادات.</div>' +
      '<form id="lgForm">' +
        '<label for="lgUser">اسم المستخدم</label><input id="lgUser" autocomplete="username" required>' +
        '<label for="lgPin">رقم سري (4 أرقام)</label>' +
        '<input id="lgPin" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password" class="lg-pin" placeholder="• • • •" required>' +
        '<label for="lgPin2">أكّد الرقم</label>' +
        '<input id="lgPin2" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password" class="lg-pin" placeholder="• • • •" required>' +
        '<button type="submit" class="lg-btn">إنشاء الحساب والدخول</button>' +
        '<div id="lgErr" class="lg-err"></div>' +
      '</form>';
    body.querySelector('#lgForm').onsubmit = function (e) {
      e.preventDefault();
      var name = body.querySelector('#lgUser').value.trim();
      var p1 = body.querySelector('#lgPin').value, p2 = body.querySelector('#lgPin2').value;
      if (name.length < 2) { err('اكتب اسم المستخدم'); return; }
      if (!validPin(p1)) { err('الرقم السري لازم 4 أرقام'); return; }
      if (p1 !== p2) { err('الرقمين مش زي بعض'); return; }
      if (admins().length) { drawLogin(); return; }   /* حد سبقه وعمل حساب من جهاز تاني */
      var a = { id: AMB.uid('adm'), user: name, salt: newSalt(), owner: true };
      hashPin(a.salt, p1).then(function (h) {
        a.pinH = h;
        saveAdmins([a]);
        enter(a, true);
        AMB.toast('✓ اتعمل حساب ' + name + ' — تقدر تضيف باقي المديرين من الإعدادات', 'ok', 6000);
      });
    };
  }

  /* لازم نستنى الإعدادات توصل من السحابة قبل ما نقرر — جهاز جديد ممكن يبان
     إن مفيش حسابات وهي موجودة بس لسه ما نزلتش */
  function waitAndDraw() {
    var t0 = Date.now(), liveSince = 0, drawn = false;
    (function tick() {
      if (!gate) return;
      var a = silentLogin();
      if (a) { enter(a, false); return; }
      if (admins().length) { if (!drawn) { drawn = true; drawLogin(); } return; }
      if (Sync.status === 'live' && !liveSince) liveSince = Date.now();
      var settled = (liveSince && Date.now() - liveSince > 3000) || (!Sync.config());
      if (settled) { drawFirst(); return; }
      if (Date.now() - t0 > 20000) {
        gate.querySelector('#lgBody').innerHTML =
          '<div class="lg-note">⚠ مش قادر يوصل للمركز عشان يتأكد من الحسابات. اتأكد من النت وجرّب تاني.</div>' +
          '<button class="lg-btn" onclick="location.reload()">جرّب تاني</button>';
        return;
      }
      setTimeout(tick, 400);
    })();
    /* لو حسابات وصلت من السحابة والشاشة لسه مفتوحة، نحدّث */
    S.onChange(function (col) {
      if (col !== 'settings' || !gate) return;
      var a = silentLogin();
      if (a) enter(a, false);
      else if (admins().length && !gate.querySelector('#lgUser[name="username"]')) drawLogin();
    });
  }

  /* ---------------- إدارة الحسابات (كارت في الإعدادات) ---------------- */

  function adminsCard(container) {
    if (!container || !me) return;
    var list = admins();
    var isOwner = !!me.owner;
    var h = '<div class="card"><div class="card-h"><h3>👤 حسابات المديرين</h3><span class="spacer"></span>' +
      '<span class="small muted">إنت داخل باسم <strong>' + esc(me.user) + '</strong></span></div><div class="card-b">' +
      '<ul class="list">' + list.map(function (a) {
        return '<li><div style="flex:1"><div class="ttl">' + esc(a.user) + (a.owner ? ' <span class="tag info">المالك</span>' : '') +
          (a.id === me.id ? ' <span class="tag ok">إنت</span>' : '') + '</div></div>' +
          ((a.id === me.id || isOwner) ? '<button class="btn sm" data-adpin="' + a.id + '">تغيير الرقم</button>' : '') +
          (isOwner && a.id !== me.id ? '<button class="btn sm danger" data-addel="' + a.id + '">حذف</button>' : '') + '</li>';
      }).join('') + '</ul>' +
      (isOwner ? '<button class="btn pri" id="adAdd" style="margin-top:10px">+ مدير جديد</button>'
               : '<div class="small muted" style="margin-top:8px">إضافة وحذف المديرين للمالك بس.</div>') +
      '<div class="note warn" style="margin-top:12px">الدخول ده بيمنع أي حد يفتح لوحة المدير من غير حساب. ' +
      'الحماية الكاملة للبيانات نفسها محتاجة خطوة تانية في Firebase.</div>' +
      '</div></div>';
    container.innerHTML = h;

    var add = container.querySelector('#adAdd');
    if (add) add.onclick = function () { editAdmin(null, function () { adminsCard(container); }); };
    container.querySelectorAll('[data-adpin]').forEach(function (b) {
      b.onclick = function () { editAdmin(byId(b.dataset.adpin), function () { adminsCard(container); }); };
    });
    container.querySelectorAll('[data-addel]').forEach(function (b) {
      b.onclick = function () {
        var a = byId(b.dataset.addel);
        UI.confirm('حذف حساب ' + a.user + '؟', { danger: true, detail: 'مش هيقدر يدخل لوحة المدير تاني.' }).then(function (ok) {
          if (!ok) return;
          saveAdmins(admins().filter(function (x) { return x.id !== a.id; }));
          AMB.toast('اتحذف حساب ' + a.user); adminsCard(container);
        });
      };
    });
  }

  /* مدير جديد، أو تغيير رقم مدير موجود — الرقم بيكتبه صاحبه أو المالك بإيده */
  function editAdmin(a, after) {
    var m = UI.modal({
      title: a ? 'تغيير الرقم السري — ' + a.user : '+ مدير جديد', size: 'narrow',
      body: (a ? '' : '<div class="field"><label for="_adU">اسم المستخدم</label><input id="_adU"></div>') +
        '<div class="row"><div class="field"><label for="_adP">رقم سري (4 أرقام)</label>' +
        '<input id="_adP" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password"></div>' +
        '<div class="field"><label for="_adP2">أكّده</label>' +
        '<input id="_adP2" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password"></div></div>' +
        '<div id="_adE"></div>',
      buttons: [{ text: 'حفظ', cls: 'pri', keepOpen: true, onClick: function (api) {
          var e = api.body.querySelector('#_adE');
          var name = a ? a.user : api.body.querySelector('#_adU').value.trim();
          var p1 = api.body.querySelector('#_adP').value, p2 = api.body.querySelector('#_adP2').value;
          if (!a && name.length < 2) { e.innerHTML = '<div class="note bad">اكتب اسم المستخدم</div>'; return false; }
          if (!a && findUser(name)) { e.innerHTML = '<div class="note bad">الاسم ده موجود</div>'; return false; }
          if (!validPin(p1)) { e.innerHTML = '<div class="note bad">الرقم السري لازم 4 أرقام</div>'; return false; }
          if (p1 !== p2) { e.innerHTML = '<div class="note bad">الرقمين مش زي بعض</div>'; return false; }
          var rec = a ? Object.assign({}, a) : { id: AMB.uid('adm'), user: name, owner: false };
          rec.salt = newSalt();
          hashPin(rec.salt, p1).then(function (h) {
            rec.pinH = h;
            var list = admins().filter(function (x) { return x.id !== rec.id; });
            list.push(rec);
            saveAdmins(list);
            if (me && rec.id === me.id) {
              me = rec;
              try { if (localStorage.getItem(REMEMBER)) localStorage.setItem(REMEMBER, JSON.stringify({ id: rec.id, h: rec.pinH })); } catch (x) { }
            }
            api.close();
            AMB.toast(a ? '✓ اتغير الرقم السري' : '✓ اتضاف ' + name, 'ok');
            if (after) after();
          });
          return false;
        } }, { spacer: true }, { text: 'إغلاق' }]
    });
    m.body.querySelectorAll('input[inputmode=numeric]').forEach(function (i) {
      i.addEventListener('input', function () { i.value = i.value.replace(/\D/g, '').slice(0, 4); });
    });
  }

  /* ---------------- الإقلاع ---------------- */

  /* بيشتغل قبل لوحة المدير: الشاشة بتتقفل لحد ما حد يدخل */
  document.addEventListener('DOMContentLoaded', function () {
    var a = silentLogin();
    if (a) { enter(a, false); return; }
    document.body.classList.add('gated');
    buildGate();
    waitAndDraw();
  });

  AMB.Login = { adminsCard: adminsCard, current: function () { return me; }, logout: logout };

})(window);
