/* ============================================================
   عناصر الواجهة المشتركة — نوافذ، نماذج، تأكيدات
   ============================================================ */
(function (global) {
  'use strict';

  var esc = AMB.esc;

  /* ---------------- النوافذ المنبثقة ---------------- */

  var openStack = [];

  function modal(opts) {
    var bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML =
      '<div class="modal ' + (opts.size || '') + '">' +
        '<div class="modal-h">' +
          '<h3>' + esc(opts.title || '') + '</h3>' +
          '<button class="modal-x" type="button" aria-label="إغلاق">×</button>' +
        '</div>' +
        '<div class="modal-b"></div>' +
        (opts.footer === false ? '' : '<div class="modal-f"></div>') +
      '</div>';

    var body = bg.querySelector('.modal-b');
    var foot = bg.querySelector('.modal-f');

    if (typeof opts.body === 'string') body.innerHTML = opts.body;
    else if (opts.body) body.appendChild(opts.body);

    var api = {
      el: bg, body: body, foot: foot,
      close: function () {
        bg.remove();
        var i = openStack.indexOf(api);
        if (i > -1) openStack.splice(i, 1);
        if (!openStack.length) document.body.style.overflow = '';
        if (opts.onClose) opts.onClose();
      },
      setBody: function (html) { body.innerHTML = html; }
    };

    (opts.buttons || []).forEach(function (b) {
      if (b.spacer) { var sp = document.createElement('span'); sp.className = 'spacer'; foot.appendChild(sp); return; }
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn ' + (b.cls || '');
      btn.textContent = b.text;
      if (b.id) btn.id = b.id;
      btn.onclick = function () { if (!b.onClick || b.onClick(api) !== false) { if (b.keepOpen !== true) api.close(); } };
      foot.appendChild(btn);
    });

    bg.querySelector('.modal-x').onclick = api.close;
    bg.onclick = function (e) { if (e.target === bg && opts.dismissable !== false) api.close(); };

    document.getElementById('modalHost').appendChild(bg);
    document.body.style.overflow = 'hidden';
    openStack.push(api);

    setTimeout(function () {
      var f = body.querySelector('input:not([type=hidden]),select,textarea');
      if (f && !('ontouchstart' in window)) f.focus();
    }, 60);

    if (opts.onReady) opts.onReady(api);
    return api;
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && openStack.length) openStack[openStack.length - 1].close();
  });

  function confirmBox(msg, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var done = false;
      modal({
        title: opts.title || 'تأكيد',
        size: 'narrow',
        body: '<p style="margin:0">' + esc(msg) + '</p>' +
              (opts.detail ? '<p class="small muted" style="margin-top:8px">' + esc(opts.detail) + '</p>' : ''),
        buttons: [
          { text: opts.yes || 'تأكيد', cls: opts.danger ? 'danger' : 'pri', onClick: function () { done = true; resolve(true); } },
          { text: 'إلغاء', onClick: function () { done = true; resolve(false); } }
        ],
        onClose: function () { if (!done) resolve(false); }
      });
    });
  }

  function promptBox(label, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var done = false;
      var m = modal({
        title: opts.title || 'إدخال',
        size: 'narrow',
        body: '<div class="field"><label>' + esc(label) + '</label>' +
              '<input type="' + (opts.type || 'text') + '" id="_pv" value="' + esc(opts.value || '') + '" ' +
              (opts.placeholder ? 'placeholder="' + esc(opts.placeholder) + '"' : '') + '></div>' +
              (opts.hint ? '<p class="small muted">' + esc(opts.hint) + '</p>' : ''),
        buttons: [
          { text: 'موافق', cls: 'pri', onClick: function (api) { done = true; resolve(api.body.querySelector('#_pv').value); } },
          { text: 'إلغاء', onClick: function () { done = true; resolve(null); } }
        ],
        onClose: function () { if (!done) resolve(null); }
      });
      m.body.querySelector('#_pv').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { done = true; resolve(this.value); m.close(); }
      });
    });
  }

  /* ---------------- بناء الحقول ---------------- */

  function field(o) {
    var id = o.id || AMB.uid('f');
    var h = '<div class="field"' + (o.hide ? ' style="display:none"' : '') + '>';
    if (o.label) h += '<label for="' + id + '">' + esc(o.label) + (o.req ? ' <span style="color:var(--bad)">*</span>' : '') + '</label>';

    if (o.type === 'select') {
      h += '<select id="' + id + '"' + (o.multiple ? ' multiple' : '') + '>';
      (o.options || []).forEach(function (op) {
        var val = op.value !== undefined ? op.value : op;
        var txt = op.text !== undefined ? op.text : op;
        h += '<option value="' + esc(val) + '"' + (String(val) === String(o.value) ? ' selected' : '') + '>' + esc(txt) + '</option>';
      });
      h += '</select>';
    } else if (o.type === 'textarea') {
      h += '<textarea id="' + id + '"' + (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') +
           (o.rows ? ' rows="' + o.rows + '"' : '') + '>' + esc(o.value || '') + '</textarea>';
    } else if (o.type === 'checks') {
      h += '<div class="checks" id="' + id + '">';
      (o.options || []).forEach(function (op) {
        var on = (o.value || []).indexOf(op.value) > -1;
        h += '<label class="chk' + (on ? ' on' : '') + '"><input type="checkbox" value="' + esc(op.value) + '"' +
             (on ? ' checked' : '') + '>' + esc(op.text) + '</label>';
      });
      h += '</div>';
    } else if (o.type === 'static') {
      h += '<div class="small" style="padding:8px 11px;background:var(--panel2);border:1px solid var(--line);border-radius:8px">' +
           (o.html || esc(o.value || '')) + '</div>';
    } else {
      h += '<input type="' + (o.type || 'text') + '" id="' + id + '" value="' + esc(o.value == null ? '' : o.value) + '"' +
           (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') +
           (o.step ? ' step="' + o.step + '"' : '') +
           (o.min !== undefined ? ' min="' + o.min + '"' : '') +
           (o.max !== undefined ? ' max="' + o.max + '"' : '') + '>';
    }
    if (o.hint) h += '<div class="hint">' + (o.hintHtml || esc(o.hint)) + '</div>';
    h += '</div>';
    return h;
  }

  /* قراءة قيم النموذج من عنصر حاوٍ */
  function readForm(root, spec) {
    var out = {};
    Object.keys(spec).forEach(function (key) {
      var s = spec[key];
      var el = root.querySelector('#' + s.id);
      if (!el) return;
      if (s.type === 'checks') {
        out[key] = Array.prototype.slice.call(el.querySelectorAll('input:checked')).map(function (i) { return i.value; });
      } else if (s.type === 'number') {
        out[key] = el.value === '' ? null : Number(el.value);
      } else {
        out[key] = el.value.trim ? el.value.trim() : el.value;
      }
    });
    return out;
  }

  /* تفعيل مظهر الاختيار في .checks */
  document.addEventListener('change', function (e) {
    if (e.target.matches('.checks input[type=checkbox]')) {
      e.target.closest('.chk').classList.toggle('on', e.target.checked);
    }
  });

  /* ---------------- حالة فارغة ---------------- */

  function empty(icon, title, sub, btn) {
    return '<div class="empty"><div class="big">' + icon + '</div>' +
      '<p style="font-weight:600;color:var(--ink2)">' + esc(title) + '</p>' +
      (sub ? '<p class="small">' + esc(sub) + '</p>' : '') +
      (btn ? '<div style="margin-top:12px">' + btn + '</div>' : '') + '</div>';
  }

  /* ---------------- تصدير CSV مع دعم العربية ---------------- */

  function downloadCSV(filename, rows) {
    var csv = rows.map(function (r) {
      return r.map(function (c) {
        c = c == null ? '' : String(c);
        return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c;
      }).join(',');
    }).join('\r\n');
    // BOM عشان إكسل يقرأ العربية صح
    download(filename, new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  }

  function download(filename, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function downloadJSON(filename, obj) {
    download(filename, new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
  }

  function pickFile(accept) {
    return new Promise(function (resolve) {
      var inp = document.createElement('input');
      inp.type = 'file'; inp.accept = accept || '';
      inp.onchange = function () { resolve(inp.files[0] || null); };
      inp.click();
    });
  }

  /* ---------------- مُنتقي الموقع على الخريطة ---------------- */

  function pickLocation(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var chosen = (opts.lat != null) ? { lat: opts.lat, lng: opts.lng } : null;
      var radius = opts.radius || 200;
      var map = null, done = false;

      var m = modal({
        title: opts.title || 'تحديد الموقع',
        size: 'wide',
        body:
          '<div class="note">اختر الموقع بأي طريقة: <strong>اضغط على الخريطة</strong> ' +
          '— أو <strong>الصق رابط جوجل مابس</strong> — أو <strong>«خذ موقعي الآن»</strong> لو كنت واقفاً في المكان.</div>' +
          '<div class="btn-row" style="margin-bottom:10px">' +
            '<button class="btn acc sm" id="_here">📍 خذ موقعي الآن</button>' +
            '<input type="text" id="_paste" placeholder="الصق رابط جوجل مابس أو  30.089, 31.328" style="flex:1;min-width:200px">' +
            '<button class="btn sm" id="_go">تطبيق</button>' +
          '</div>' +
          '<div id="_map" class="map-mid" style="border:1px solid var(--line)"></div>' +
          '<div class="row" style="margin-top:12px">' +
            '<div class="field" style="margin:0"><label>نطاق التحقق من الحضور (متر)</label>' +
              '<input type="number" id="_rad" value="' + radius + '" min="30" max="3000" step="10">' +
              '<div class="hint">يُعتبر الحضور صحيحاً لو المسعف داخل الدائرة دي. 200 متر مناسبة لملعب عادي.</div>' +
            '</div>' +
            '<div class="field" style="margin:0"><label>الإحداثيات المختارة</label>' +
              '<div class="mono small" id="_coords" style="padding:9px 11px;background:var(--panel2);border:1px solid var(--line);border-radius:8px">' +
              (chosen ? chosen.lat.toFixed(6) + ', ' + chosen.lng.toFixed(6) : 'لم يُحدَّد بعد') + '</div>' +
            '</div>' +
          '</div>',
        buttons: [
          { text: 'حفظ الموقع', cls: 'pri', keepOpen: true, onClick: function (api) {
              if (!chosen) { AMB.toast('حدد الموقع الأول', 'warn'); return false; }
              done = true;
              resolve({ lat: chosen.lat, lng: chosen.lng, radius: Number(api.body.querySelector('#_rad').value) || 200 });
              api.close();
            } },
          { text: 'إلغاء', onClick: function () { done = true; resolve(null); } }
        ],
        onClose: function () { if (!done) resolve(null); if (map) map.destroy(); }
      });

      function refresh() {
        var mk = [], ci = [];
        if (chosen) {
          mk.push({ lat: chosen.lat, lng: chosen.lng, color: '#c1121f', kind: 'venue', label: opts.label || 'الموقع' });
          ci.push({ lat: chosen.lat, lng: chosen.lng, radius: Number(m.body.querySelector('#_rad').value) || 200, color: '#c1121f' });
        }
        (opts.others || []).forEach(function (o) {
          mk.push({ lat: o.lat, lng: o.lng, color: '#8b97a8', kind: 'venue', label: o.name });
        });
        map.setMarkers(mk); map.setCircles(ci);
        m.body.querySelector('#_coords').textContent = chosen
          ? chosen.lat.toFixed(6) + ', ' + chosen.lng.toFixed(6) : 'لم يُحدَّد بعد';
      }

      setTimeout(function () {
        map = new MiniMap(m.body.querySelector('#_map'), {
          center: chosen || opts.fallbackCenter || { lat: 30.0876, lng: 31.3260 },
          zoom: chosen ? 16 : 12,
          onClick: function (ll) { chosen = ll; refresh(); }
        });
        refresh();
        if (chosen) map.setCenter(chosen.lat, chosen.lng, 16);

        m.body.querySelector('#_rad').addEventListener('input', refresh);

        m.body.querySelector('#_here').onclick = function () {
          var b = this; b.disabled = true; b.textContent = '⏳ جاري التحديد...';
          AMB.Geo.once().then(function (p) {
            chosen = { lat: p.lat, lng: p.lng };
            map.setCenter(p.lat, p.lng, 17);
            refresh();
            AMB.toast('تم — دقة التحديد ' + p.acc + ' متر', p.acc <= 30 ? 'ok' : 'warn');
          }).catch(function (e) { AMB.toast(e.message, 'error'); })
            .finally(function () { b.disabled = false; b.textContent = '📍 خذ موقعي الآن'; });
        };

        function applyPaste() {
          var c = AMB.parseCoords(m.body.querySelector('#_paste').value);
          if (!c) { AMB.toast('لم أتعرف على إحداثيات في النص — تأكد أنه رابط جوجل مابس أو رقمين مفصولين بفاصلة', 'error'); return; }
          chosen = c; map.setCenter(c.lat, c.lng, 17); refresh();
          AMB.toast('تم تطبيق الموقع', 'ok');
        }
        m.body.querySelector('#_go').onclick = applyPaste;
        m.body.querySelector('#_paste').addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); applyPaste(); }
        });
      }, 30);
    });
  }

  global.UI = {
    modal: modal, confirm: confirmBox, prompt: promptBox,
    field: field, readForm: readForm, empty: empty,
    downloadCSV: downloadCSV, downloadJSON: downloadJSON, download: download,
    pickFile: pickFile, pickLocation: pickLocation
  };

})(window);
