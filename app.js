import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, writeBatch,
  collection, query, where, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);

const ROLES = {
  admin: "مدير البرنامج", church_admin: "مسؤول كنيسة",
  priest: "أب كاهن", recorder: "مسجّل", none: "بدون صلاحية"
};
const STATUS = { pending: "قيد الموافقة", approved: "موافَق عليه", rejected: "مرفوض" };

const S = { user: null, me: null, tab: "visits", loading: true, msg: "", detail: null,
            churches: {}, priests: {}, persons: {}, visits: {}, users: {} };
const $app = document.getElementById("app");

// ---------- أدوات ----------
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const val = id => (document.getElementById(id)?.value ?? "");
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const hm = d => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const fmtDate = s => new Date(s + "T00:00").toLocaleDateString("ar-EG", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
const fmtTime = s => { const [h, m] = s.split(":").map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString("ar-EG", { hour: "numeric", minute: "2-digit" }); };
const priestName = id => S.priests[id]?.name || "—";
const churchName = id => S.churches[id]?.name || "—";
const role = () => S.me.role;
const showPriest = () => role() === "admin" || role() === "church_admin";
const canEdit = () => role() !== "recorder";
const byName = (a, b) => a[1].name.localeCompare(b[1].name, "ar");
// توحيد الحروف العربية للبحث (أ/إ/آ=ا، ى=ي، ة=ه، وإزالة التشكيل)
const norm = s => String(s ?? "").toLowerCase()
  .replace(/[ً-ٰٟـ]/g, "")
  .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
  .replace(/\s+/g, " ").trim();

// تصفية قائمة الأشخاص في شاشة تسجيل الزيارة
function fillPersons(q) {
  const sel = document.getElementById("v-person"); if (!sel) return;
  const n = norm(q);
  // لا تظهر أسماء قبل بدء الكتابة
  const list = !n ? [] : Object.entries(S.persons)
    .filter(([, p]) => norm(p.name + " " + (p.address || "")).includes(n)).sort(byName);
  sel.innerHTML = list.map(([id, p]) =>
    `<option value="${esc(id)}">${esc(p.name)}${showPriest() ? " — " + esc(priestName(p.priestId)) : ""}</option>`).join("");
  sel.hidden = !list.length;
  if (list.length === 1) sel.value = list[0][0];
  const c = document.getElementById("v-count");
  if (c) c.textContent = !n ? "اكتب جزءًا من الاسم لإظهار النتائج" : list.length ? list.length + " اسم" : "لا توجد نتائج";
}

function flash(m) {
  S.msg = m;
  const el = document.getElementById("msg");
  if (el) el.textContent = m;
}
async function run(fn) {
  try { await fn(); } catch (e) { console.error(e); flash("خطأ: " + (e.code || e.message)); }
}

// ---------- تحميل البيانات حسب الصلاحية ----------
function scoped(name) {
  const c = collection(db, name);
  if (role() === "admin") return query(c);
  if (role() === "church_admin") return query(c, where("churchId", "==", S.me.churchId));
  return query(c, where("priestId", "==", S.me.priestId), where("churchId", "==", S.me.churchId));
}
async function loadData() {
  S.churches = {}; S.priests = {}; S.persons = {}; S.visits = {};
  if (role() === "admin") {
    (await getDocs(collection(db, "churches"))).forEach(d => S.churches[d.id] = d.data());
    (await getDocs(collection(db, "priests"))).forEach(d => S.priests[d.id] = d.data());
  } else {
    if (S.me.churchId) {
      const c = await getDoc(doc(db, "churches", S.me.churchId));
      if (c.exists()) S.churches[c.id] = c.data();
    }
    if (role() === "church_admin") {
      (await getDocs(query(collection(db, "priests"), where("churchId", "==", S.me.churchId))))
        .forEach(d => S.priests[d.id] = d.data());
    } else if (S.me.priestId) {
      const p = await getDoc(doc(db, "priests", S.me.priestId));
      if (p.exists()) S.priests[p.id] = p.data();
    }
  }
  (await getDocs(scoped("persons"))).forEach(d => S.persons[d.id] = d.data());
  (await getDocs(scoped("visits"))).forEach(d => S.visits[d.id] = d.data());
}
async function loadUsers() {
  S.users = {};
  (await getDocs(collection(db, "users"))).forEach(d => S.users[d.id] = d.data());
}

// ---------- المصادقة ----------
async function ensureUserDoc(u) {
  const ref = doc(db, "users", u.uid);
  let snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      email: u.email, name: u.displayName || u.email.split("@")[0],
      role: "none", status: "pending", createdAt: serverTimestamp()
    });
    snap = await getDoc(ref);
  }
  S.me = { id: u.uid, ...snap.data() };
}
onAuthStateChanged(auth, async u => {
  S.user = u; S.me = null; S.msg = "";
  if (u) {
    S.loading = true; render();
    try {
      await ensureUserDoc(u);
      if (S.me.status === "approved") await loadData();
    } catch (e) { console.error(e); S.msg = "خطأ: " + (e.code || e.message); }
  }
  S.loading = false; render();
});

// ---------- العرض ----------
function render() {
  if (S.loading) { $app.innerHTML = '<p class="center">جارٍ التحميل…</p>'; return; }
  if (!S.user) { $app.innerHTML = loginView(); return; }
  if (!S.me || S.me.status !== "approved") {
    const rej = S.me?.status === "rejected";
    $app.innerHTML = header() + `<main><div class="card center">
      <h3>${rej ? "تم رفض طلبك" : "طلبك قيد المراجعة"}</h3>
      <p>${rej ? "تواصل مع مدير البرنامج." : "سيقوم مدير البرنامج بالموافقة على حسابك وتحديد صلاحياتك."}</p>
      <p class="msg" id="msg">${esc(S.msg)}</p>
      <button data-act="refresh">تحديث الحالة</button></div></main>`;
    return;
  }
  const tabs = [["visits", "الزيارات"], ["persons", "الأشخاص"]];
  if (role() === "admin" || role() === "church_admin") tabs.push(["priests", "الآباء الكهنة"]);
  if (role() === "admin") { tabs.push(["churches", "الكنائس"]); tabs.push(["users", "المستخدمون"]); }
  const views = { visits: visitsView, persons: personsView, priests: priestsView, churches: churchesView, users: usersView };
  const prevNav = document.querySelector("nav")?.scrollLeft ?? 0;
  $app.innerHTML = header() +
    `<nav>${tabs.map(([k, v]) => `<button class="${S.tab === k ? "on" : ""}" data-act="tab" data-v="${k}">${ICON[k] || ""}${v}</button>`).join("")}</nav>` +
    `<main><div class="msg" id="msg">${esc(S.msg)}</div>${views[S.tab]()}</main>${ORN}`;
  // إبقاء شريط التبويبات في مكانه، والتأكد أن التبويب المختار ظاهر
  const nav = document.querySelector("nav");
  if (nav) {
    nav.scrollLeft = prevNav;
    document.querySelector("nav button.on")?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }
}
// ---------- الأيقونات والزخارف ----------
const svg = p => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const ICON = {
  visits: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  persons: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 14c2.6.2 4.5 2 4.5 5"/>'),
  priests: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7M8 4h8"/>'),
  churches: svg('<path d="M12 2v5M9.5 4.5h5M5 21V12l7-5 7 5v9zM10 21v-5h4v5"/>'),
  users: svg('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>'),
  upload: svg('<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>'),
  logout: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>')
};
const CROSS = `<svg class="cross" viewBox="0 0 60 90" aria-hidden="true"><g fill="none" stroke="#D4AF37" stroke-width="5" stroke-linecap="round"><path d="M30 6v78M10 32h40M20 16h20M20 66h20"/></g><path d="M30 24l7 8-7 8-7-8z" fill="#D4AF37"/></svg>`;
const CHURCH = `<svg class="church" viewBox="0 0 120 72" fill="#D4AF37" aria-hidden="true"><rect x="8" y="42" width="16" height="30"/><path d="M8 42q8-14 16 0z"/><rect x="30" y="32" width="28" height="40"/><path d="M30 32q14-26 28 0z"/><rect x="43" y="4" width="2" height="12"/><rect x="39" y="8" width="10" height="2"/><rect x="64" y="46" width="18" height="26"/><path d="M64 46q9-13 18 0z"/><rect x="88" y="54" width="24" height="18"/></svg>`;
const ORN = `<div class="orn"><span></span>${CROSS}<span></span></div>`;

function header() {
  return `<header class="top">${CHURCH}
    <div class="hrow">${CROSS}
      <div class="ttl"><strong>سجل زيارات الاعتراف</strong>
      <small>${S.me ? esc(S.me.name) + " — " + ROLES[S.me.role] : ""}</small></div>
      ${S.user ? `<button class="hbtn" data-act="logout">${ICON.logout}خروج</button>` : ""}</div>
    <svg class="wave" viewBox="0 0 400 26" preserveAspectRatio="none" aria-hidden="true"><path d="M0 26V12C70 -2 140 24 220 12S350 0 400 10V26Z" fill="#FAF6E9"/><path d="M0 12C70 -2 140 24 220 12S350 0 400 10" fill="none" stroke="#D4AF37" stroke-width="2"/></svg></header>`;
}
function loginView() {
  return header() + `<div class="login"><div class="card">
    <h2 class="center" style="padding:0;color:var(--pri)">تسجيل الدخول</h2>
    <button data-act="google" style="width:100%">الدخول بحساب Google</button>
    <hr>
    <input id="l-email" type="email" placeholder="البريد الإلكتروني" dir="ltr">
    <input id="l-pass" type="password" placeholder="كلمة المرور (6 أحرف على الأقل)" dir="ltr">
    <div class="row"><button data-act="login">دخول</button>
    <button class="sec" data-act="signup">طلب حساب جديد</button></div>
    <p class="msg" id="msg">${esc(S.msg)}</p>
    <small>الحسابات الجديدة تحتاج موافقة مدير البرنامج.</small>
  </div></div>`;
}

function personOpts() {
  return Object.entries(S.persons).sort(byName).map(([id, p]) =>
    `<option value="${esc(id)}">${esc(p.name)}${showPriest() ? " — " + esc(priestName(p.priestId)) : ""}</option>`).join("");
}
function priestOpts(sel, withChurch) {
  return Object.entries(S.priests).sort(byName).map(([id, p]) =>
    `<option value="${esc(id)}" ${sel === id ? "selected" : ""}>${esc(p.name)}${withChurch ? " (" + esc(churchName(p.churchId)) + ")" : ""}</option>`).join("");
}
function churchOpts(sel) {
  return Object.entries(S.churches).sort(byName).map(([id, c]) =>
    `<option value="${esc(id)}" ${sel === id ? "selected" : ""}>${esc(c.name)}</option>`).join("");
}
const visitsOf = pid => Object.entries(S.visits).filter(([, v]) => v.personId === pid)
  .sort((a, b) => (b[1].date + b[1].time).localeCompare(a[1].date + a[1].time));

function visitsView() {
  const now = new Date();
  const rows = Object.entries(S.visits)
    .sort((a, b) => (b[1].date + b[1].time).localeCompare(a[1].date + a[1].time)).slice(0, 300)
    .map(([id, v]) => `<tr><td>${esc(fmtDate(v.date))}</td><td>${esc(fmtTime(v.time))}</td>
      <td>${esc(S.persons[v.personId]?.name || "—")}</td>
      ${showPriest() ? `<td>${esc(priestName(v.priestId))}</td>` : ""}
      ${canEdit() ? `<td><button class="danger sm" data-act="del-visit" data-id="${esc(id)}">حذف</button></td>` : ""}</tr>`).join("");
  return `<div class="card"><h3 class="band">${ICON.visits}تسجيل زيارة</h3><div class="row">
      <label style="flex:1 1 100%">الشخص (ابحث ثم اختر)
        <input id="v-search" data-pfilter="1" placeholder="اكتب جزءًا من الاسم…" autocomplete="off">
        <select id="v-person" size="5" hidden></select>
        <small id="v-count">اكتب جزءًا من الاسم لإظهار النتائج</small></label>
      <label>اليوم<input id="v-date" type="date" value="${ymd(now)}"></label>
      <label>الميعاد<input id="v-time" type="time" value="${hm(now)}"></label>
      <button data-act="add-visit">تسجيل</button></div></div>
    <div class="card"><div class="row"><h3 style="flex:1;margin:0">آخر الزيارات</h3>
      <input data-filter="v-body" placeholder="بحث بالاسم…" style="max-width:220px">
      ${canEdit() ? '<button class="sec" data-act="export">تصدير CSV</button>' : ""}</div>
      <div class="tw"><table><thead><tr><th>اليوم</th><th>الميعاد</th><th>الاسم</th>${showPriest() ? "<th>الأب الكاهن</th>" : ""}${canEdit() ? "<th></th>" : ""}</tr></thead>
      <tbody id="v-body">${rows || ""}</tbody></table></div></div>`;
}

function personsView() {
  const add = canEdit() ? `<div class="card"><h3 class="band">${ICON.persons}إضافة شخص (مرة واحدة)</h3><div class="row">
      <label>الاسم<input id="p-name"></label>
      <label>الهاتف (اختياري)<input id="p-phone" dir="ltr"></label>
      <label>العنوان (اختياري)<input id="p-address"></label>
      <label>السن (اختياري)<input id="p-age" type="number" min="1" max="120" inputmode="numeric"></label>
      ${role() === "priest" ? "" : `<label>الأب الكاهن<select id="p-priest"><option value="">اختر…</option>${priestOpts("", role() === "admin")}</select></label>`}
      <button data-act="add-person">إضافة</button></div></div>` : "";
  const rows = Object.entries(S.persons).sort(byName).map(([id, p]) => {
    const vs = visitsOf(id);
    return `<tr><td>${esc(p.name)}${p.age ? `<br><small>${p.age} سنة</small>` : ""}</td><td>${esc(p.address || "—")}</td>${showPriest() ? `<td>${esc(priestName(p.priestId))}</td>` : ""}
      <td>${vs.length}</td><td class="hm">${vs[0] ? esc(fmtDate(vs[0][1].date)) : "—"}</td>
      <td><div class="acts"><button class="sec sm" data-act="detail" data-id="${esc(id)}">السجل</button>
      ${canEdit() ? `<button class="danger sm" data-act="del-person" data-id="${esc(id)}">حذف</button>` : ""}</div></td></tr>`;
  }).join("");
  let detail = "";
  if (S.detail && S.persons[S.detail]) {
    const dp = S.persons[S.detail];
    detail = `<div class="card"><h3>زيارات: ${esc(dp.name)}</h3>
      <p style="color:var(--mute);margin:0 0 8px">${[dp.age ? "السن: " + dp.age : "", dp.address ? "العنوان: " + esc(dp.address) : "", dp.phone ? "الهاتف: " + esc(dp.phone) : ""].filter(Boolean).join(" — ")}</p><table><tbody>` +
      (visitsOf(S.detail).map(([, v]) => `<tr><td>${esc(fmtDate(v.date))}</td><td>${esc(fmtTime(v.time))}</td></tr>`).join("") ||
       "<tr><td>لا توجد زيارات</td></tr>") + "</tbody></table></div>";
  }
  return add + importCard() + `<div class="card"><div class="row"><h3 style="flex:1;margin:0">الأشخاص (${Object.keys(S.persons).length})</h3>
    <input data-filter="p-body" placeholder="بحث بالاسم…" style="max-width:220px"></div>
    <div class="tw"><table><thead><tr><th>الاسم</th><th>العنوان</th>${showPriest() ? "<th>الأب الكاهن</th>" : ""}<th>عدد الزيارات</th><th class="hm">آخر زيارة</th><th></th></tr></thead>
    <tbody id="p-body">${rows}</tbody></table></div></div>` + detail;
}

// ---------- استيراد الأشخاص من Excel ----------
const toLatinDigits = s => String(s).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
const cleanPhone = s => {
  let p = toLatinDigits(s).replace(/[\s\-().]/g, "");
  if (/^1[0125]\d{8}$/.test(p)) p = "0" + p;   // إكسيل يحذف الصفر من أول الرقم
  return p;
};
const cleanAge = s => {   // السن اختياري: رقم من 1 إلى 120 وإلا null
  const n = parseInt(toLatinDigits(String(s ?? "")).trim(), 10);
  return n >= 1 && n <= 120 ? n : null;
};
const stripTitle = s => norm(s).replace(/^(القس|قس|القمص|قمص|الاب|اب|ابونا|الراهب)\s+/, "");
const noXlsx = () => typeof XLSX === "undefined" &&
  (flash("تعذّر تحميل مكتبة Excel. تأكد من الاتصال بالإنترنت ثم حدّث الصفحة."), true);

function importCard() {
  if (!canEdit()) return "";
  const I = S.imp;
  let body = `<p style="margin:0 0 10px;color:var(--mute);font-size:13px">الأعمدة: الاسم — السن (اختياري) — رقم التليفون — العنوان — الأب الكاهن
    ${role() === "priest" ? "(اختياري: الأشخاص يُسجَّلون على حسابك)" : "(مطلوب، بنفس اسمه المسجّل في البرنامج)"}.</p>
    <div class="row"><button class="sec" data-act="tpl">تحميل نموذج Excel</button>
    <label style="flex:2 1 220px">اختر ملف Excel (.xlsx / .csv)<input id="imp-file" type="file" accept=".xlsx,.xls,.csv"></label></div>`;
  if (I) {
    body += `<div class="msg" style="margin-top:12px">${esc(I.file)} — جاهز للاستيراد: <b>${I.ok.length}</b> | مكرر (يُتجاهل): <b>${I.dups}</b> | أخطاء: <b>${I.errors.length}</b></div>`;
    if (I.ok.length) {
      body += `<div class="tw"><table><thead><tr><th>الاسم</th><th>السن</th><th>التليفون</th><th>العنوان</th><th>الأب الكاهن</th></tr></thead><tbody>` +
        I.ok.slice(0, 5).map(p => `<tr><td>${esc(p.name)}</td><td>${p.age ?? "—"}</td><td dir="ltr">${esc(p.phone)}</td><td>${esc(p.address)}</td><td>${esc(priestName(p.priestId))}</td></tr>`).join("") +
        `</tbody></table></div>` + (I.ok.length > 5 ? `<small>معاينة أول 5 فقط من ${I.ok.length}</small>` : "");
    }
    if (I.errors.length) {
      body += `<div class="tw" style="margin-top:8px"><table><thead><tr><th>السطر</th><th>المشكلة (لن يُستورد)</th></tr></thead><tbody>` +
        I.errors.slice(0, 50).map(e => `<tr><td>${e.row}</td><td>${esc(e.msg)}</td></tr>`).join("") + `</tbody></table></div>` +
        (I.errors.length > 50 ? `<small>و ${I.errors.length - 50} أخطاء أخرى غير معروضة</small>` : "");
    }
    body += `<div class="row" style="margin-top:12px">${I.ok.length ? `<button data-act="imp-go">استيراد ${I.ok.length} شخص</button>` : ""}
      <button class="sec" data-act="imp-cancel">إلغاء</button></div>`;
  }
  return `<div class="card"><h3 class="band">${ICON.upload}استيراد من Excel</h3>${body}</div>`;
}

function downloadTemplate() {
  if (noXlsx()) return;
  const priests = Object.values(S.priests).sort((a, b) => a.name.localeCompare(b.name, "ar"));
  const ws = XLSX.utils.aoa_to_sheet([
    ["الاسم", "السن", "رقم التليفون", "العنوان", "الأب الكاهن"],
    ["(مثال - احذف هذا السطر) مينا جرجس", "25", "01000000000", "شارع النصر - الدور الثالث", priests[0]?.name || "القس فلان"]
  ]);
  ws["!cols"] = [{ wch: 34 }, { wch: 8 }, { wch: 16 }, { wch: 34 }, { wch: 28 }];
  ws["!views"] = [{ RTL: true }];
  const ws2 = XLSX.utils.aoa_to_sheet([["الأب الكاهن", "الكنيسة"], ...priests.map(p => [p.name, churchName(p.churchId)])]);
  ws2["!cols"] = [{ wch: 28 }, { wch: 28 }];
  ws2["!views"] = [{ RTL: true }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "الأشخاص");
  XLSX.utils.book_append_sheet(wb, ws2, "الآباء الكهنة");
  XLSX.writeFile(wb, "persons-template.xlsx");
}

async function parseImport(file) {
  if (!file || noXlsx()) return;
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", codepage: 65001 });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "" });
  if (rows.length > 2001) return flash("الملف كبير: الحد الأقصى 2000 سطر في المرة الواحدة");
  const h = rows.findIndex(r => r.some(c => String(c).trim()));
  if (h < 0) return flash("الملف فارغ");
  const hdr = rows[h].map(String);
  const col = re => hdr.findIndex(x => re.test(norm(x)));
  const iPriest = col(/كاهن|^الاب$|^اب$|ابونا|priest/);
  const iChurch = col(/كنيس|church/);
  const iPhone = col(/تليف|هاتف|موبايل|محمول|رقم|phone|mobile|tel/);
  const iAddr = col(/عنوان|address/);
  const iAge = col(/^(السن|سن|العمر|عمر)$|age/);
  const iName = hdr.findIndex((x, i) => /اسم|name/.test(norm(x)) && i !== iPriest && i !== iChurch);
  if (iName < 0) return flash('لم أجد عمود "الاسم" في أول سطر بالملف');
  if (role() !== "priest" && iPriest < 0) return flash('لم أجد عمود "الأب الكاهن" في أول سطر بالملف');

  const cell = (r, i) => i < 0 ? "" : String(r[i] ?? "").trim();
  const seen = new Set(Object.values(S.persons).map(p => p.priestId + "|" + norm(p.name)));
  const ok = [], errors = []; let dups = 0;
  rows.slice(h + 1).forEach((r, k) => {
    const row = h + 2 + k;   // رقم السطر كما يظهر في Excel
    const name = cell(r, iName).replace(/\s+/g, " "), phone = cleanPhone(cell(r, iPhone));
    const address = cell(r, iAddr), pr = cell(r, iPriest), ch = cell(r, iChurch);
    const ageRaw = cell(r, iAge), age = cleanAge(ageRaw);
    if (!name && !phone && !address && !pr) return;          // سطر فارغ
    if (name.startsWith("(مثال")) return;                    // سطر المثال في النموذج
    if (!name) return errors.push({ row, msg: "الاسم فارغ" });
    if (name.length > 100) return errors.push({ row, msg: "الاسم أطول من 100 حرف" });
    if (ageRaw && age === null) return errors.push({ row, msg: `السن غير صحيح (${ageRaw}) — اتركه فارغًا أو اكتب رقمًا من 1 إلى 120` });
    let priestId, churchId;
    if (role() === "priest") { priestId = S.me.priestId; churchId = S.me.churchId; }
    else {
      if (!pr) return errors.push({ row, msg: `الأب الكاهن فارغ (${name})` });
      let c = Object.entries(S.priests).filter(([, p]) => stripTitle(p.name) === stripTitle(pr));
      if (c.length > 1 && ch) c = c.filter(([, p]) => norm(churchName(p.churchId)).includes(norm(ch)));
      if (!c.length) return errors.push({ row, msg: `الأب الكاهن غير مسجّل في البرنامج: ${pr}` });
      if (c.length > 1) return errors.push({ row, msg: `يوجد أكثر من أب كاهن بنفس الاسم (${pr}). أضف عمود "الكنيسة"` });
      priestId = c[0][0]; churchId = c[0][1].churchId;
    }
    const key = priestId + "|" + norm(name);
    if (seen.has(key)) return void dups++;
    seen.add(key);
    ok.push({ name, phone, address, age, priestId, churchId });
  });
  S.imp = { file: file.name, ok, dups, errors };
  S.msg = "";
  render();
}

function priestsView() {
  const rows = Object.entries(S.priests).sort(byName).map(([id, p]) =>
    `<tr><td>${esc(p.name)}</td><td>${esc(churchName(p.churchId))}</td>
     <td><button class="danger" data-act="del-priest" data-id="${esc(id)}">حذف</button></td></tr>`).join("");
  return `<div class="card"><h3 class="band">${ICON.priests}إضافة أب كاهن</h3><div class="row">
    <label>الاسم<input id="pr-name"></label>
    ${role() === "admin" ? `<label>الكنيسة<select id="pr-church"><option value="">اختر…</option>${churchOpts("")}</select></label>` : ""}
    <button data-act="add-priest">إضافة</button></div></div>
    <div class="card"><div class="tw"><table><thead><tr><th>الاسم</th><th>الكنيسة</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function churchesView() {
  const rows = Object.entries(S.churches).sort(byName).map(([id, c]) =>
    `<tr><td>${esc(c.name)}</td><td><button class="danger" data-act="del-church" data-id="${esc(id)}">حذف</button></td></tr>`).join("");
  return `<div class="card"><h3 class="band">${ICON.churches}إضافة كنيسة</h3><div class="row">
    <label>الاسم<input id="c-name"></label><button data-act="add-church">إضافة</button></div></div>
    <div class="card"><table><tbody>${rows}</tbody></table></div>`;
}

function usersView() {
  const order = { pending: 0, approved: 1, rejected: 2 };
  const rows = Object.entries(S.users).sort((a, b) => order[a[1].status] - order[b[1].status]).map(([id, u]) =>
    `<tr><td>${esc(u.name)}<br><small>${esc(u.email)}</small></td>
     <td><span class="tag ${u.status === "approved" ? "ok" : ""}">${STATUS[u.status] || esc(u.status)}</span></td>
     <td><select id="u-role-${esc(id)}">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${u.role === k ? "selected" : ""}>${v}</option>`).join("")}</select></td>
     <td><select id="u-church-${esc(id)}"><option value="">—</option>${churchOpts(u.churchId)}</select></td>
     <td><select id="u-priest-${esc(id)}"><option value="">—</option>${priestOpts(u.priestId, true)}</select></td>
     <td><button data-act="user-save" data-id="${esc(id)}" data-status="approved">موافقة / حفظ</button>
     <button class="danger" data-act="user-save" data-id="${esc(id)}" data-status="rejected">رفض</button></td></tr>`).join("");
  return `<div class="card"><div class="tw"><table><thead><tr><th>المستخدم</th><th>الحالة</th><th>الدور</th><th>الكنيسة</th><th>الأب الكاهن</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table></div>
    <small>مسؤول كنيسة: يحتاج كنيسة. أب كاهن / مسجّل: يحتاج أبًا كاهنًا (تُحدَّد كنيسته تلقائيًا).</small></div>`;
}

// ---------- الأوامر ----------
async function act(a, d) {
  if (a === "tab") {
    S.tab = d.v; S.msg = ""; S.detail = null; S.imp = null;
    if (S.tab === "users") await loadUsers();
    return render();
  }
  if (a === "google") return void await signInWithPopup(auth, new GoogleAuthProvider());
  if (a === "login") return void await signInWithEmailAndPassword(auth, val("l-email").trim(), val("l-pass"));
  if (a === "signup") return void await createUserWithEmailAndPassword(auth, val("l-email").trim(), val("l-pass"));
  if (a === "logout") return void await signOut(auth);
  if (a === "refresh") { await ensureUserDoc(S.user); if (S.me.status === "approved") await loadData(); return render(); }

  if (a === "add-church") {
    const name = val("c-name").trim(); if (!name) return flash("اكتب اسم الكنيسة");
    const ref = await addDoc(collection(db, "churches"), { name });
    S.churches[ref.id] = { name }; S.msg = "تمت الإضافة"; return render();
  }
  if (a === "add-priest") {
    const name = val("pr-name").trim(); if (!name) return flash("اكتب اسم الأب الكاهن");
    const churchId = role() === "admin" ? val("pr-church") : S.me.churchId;
    if (!churchId) return flash("اختر الكنيسة");
    const data = { name, churchId };
    const ref = await addDoc(collection(db, "priests"), data);
    S.priests[ref.id] = data; S.msg = "تمت الإضافة"; return render();
  }
  if (a === "add-person") {
    const name = val("p-name").trim(); if (!name) return flash("اكتب الاسم");
    if (val("p-age").trim() && !cleanAge(val("p-age"))) return flash("السن غير صحيح (من 1 إلى 120)");
    let priestId, churchId;
    if (role() === "priest") { priestId = S.me.priestId; churchId = S.me.churchId; }
    else { priestId = val("p-priest"); if (!priestId) return flash("اختر الأب الكاهن"); churchId = S.priests[priestId].churchId; }
    const dup = Object.values(S.persons).some(p => p.priestId === priestId && p.name === name);
    if (dup && !confirm("يوجد شخص بنفس الاسم عند هذا الأب. هل تريد الإضافة مرة أخرى؟")) return;
    const data = { name, phone: val("p-phone").trim(), address: val("p-address").trim(), age: cleanAge(val("p-age")), priestId, churchId, createdAt: serverTimestamp() };
    const ref = await addDoc(collection(db, "persons"), data);
    S.persons[ref.id] = { ...data, createdAt: null }; S.msg = "تمت الإضافة"; return render();
  }
  if (a === "add-visit") {
    const personId = val("v-person"), date = val("v-date"), time = val("v-time");
    if (!personId || !date || !time) return flash("اختر الشخص واليوم والميعاد");
    const p = S.persons[personId];
    const data = { personId, priestId: p.priestId, churchId: p.churchId, date, time, createdBy: S.me.id, createdAt: serverTimestamp() };
    const ref = await addDoc(collection(db, "visits"), data);
    S.visits[ref.id] = { ...data, createdAt: null }; S.msg = "تم تسجيل الزيارة"; return render();
  }
  if (a === "detail") { S.detail = S.detail === d.id ? null : d.id; return render(); }
  if (a === "del-visit") {
    if (!confirm("حذف هذه الزيارة؟")) return;
    await deleteDoc(doc(db, "visits", d.id)); delete S.visits[d.id]; return render();
  }
  if (a === "del-person") {
    if (!confirm("حذف الشخص وكل زياراته؟")) return;
    for (const [vid] of visitsOf(d.id)) { await deleteDoc(doc(db, "visits", vid)); delete S.visits[vid]; }
    await deleteDoc(doc(db, "persons", d.id)); delete S.persons[d.id]; S.detail = null; return render();
  }
  if (a === "del-priest") {
    if (Object.values(S.persons).some(p => p.priestId === d.id)) return flash("لا يمكن الحذف: يوجد أشخاص تحت هذا الأب الكاهن");
    if (!confirm("حذف الأب الكاهن؟")) return;
    await deleteDoc(doc(db, "priests", d.id)); delete S.priests[d.id]; return render();
  }
  if (a === "del-church") {
    if (Object.values(S.priests).some(p => p.churchId === d.id)) return flash("لا يمكن الحذف: يوجد كهنة تحت هذه الكنيسة");
    if (!confirm("حذف الكنيسة؟")) return;
    await deleteDoc(doc(db, "churches", d.id)); delete S.churches[d.id]; return render();
  }
  if (a === "user-save") {
    const id = d.id, status = d.status;
    const r = val("u-role-" + id); let churchId = val("u-church-" + id) || null; let priestId = val("u-priest-" + id) || null;
    if (id === S.me.id && (r !== "admin" || status !== "approved")) return flash("لا يمكنك تقليل صلاحيات حسابك");
    if (status === "approved" && r === "none") return flash("اختر دورًا قبل الموافقة");
    if (r === "church_admin") { if (!churchId) return flash("اختر الكنيسة"); priestId = null; }
    if (r === "priest" || r === "recorder") {
      if (!priestId) return flash("اختر الأب الكاهن"); churchId = S.priests[priestId].churchId;
    }
    if (r === "admin" || r === "none") { churchId = null; priestId = null; }
    await updateDoc(doc(db, "users", id), { role: r, status, churchId, priestId });
    Object.assign(S.users[id], { role: r, status, churchId, priestId });
    S.msg = "تم الحفظ"; return render();
  }
  if (a === "tpl") return downloadTemplate();
  if (a === "imp-cancel") { S.imp = null; return render(); }
  if (a === "imp-go") {
    const list = S.imp?.ok || []; if (!list.length) return;
    let n = 0;
    try {
      for (let i = 0; i < list.length; i += 400) {   // حد Firestore: 500 عملية في الدفعة
        const chunk = list.slice(i, i + 400), batch = writeBatch(db), made = [];
        chunk.forEach(p => {
          const ref = doc(collection(db, "persons"));
          batch.set(ref, { ...p, createdAt: serverTimestamp() });
          made.push([ref.id, p]);
        });
        flash(`جارٍ الحفظ… ${Math.min(i + 400, list.length)} / ${list.length}`);
        await batch.commit();
        made.forEach(([id, p]) => { S.persons[id] = { ...p, createdAt: null }; });
        n += chunk.length;
      }
    } catch (e) {
      console.error(e); S.imp = null;
      S.msg = `توقف الاستيراد بعد حفظ ${n} من ${list.length} (${e.code || e.message}). راجع قائمة الأشخاص قبل إعادة الرفع لتجنب التكرار.`;
      return render();
    }
    S.imp = null; S.msg = `تم استيراد ${n} شخص`; return render();
  }
  if (a === "export") {
    const q = s => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const lines = [["اليوم", "التاريخ", "الميعاد", "الاسم", "الأب الكاهن", "الكنيسة"].map(q).join(",")];
    Object.values(S.visits).sort((x, y) => (y.date + y.time).localeCompare(x.date + x.time)).forEach(v =>
      lines.push([fmtDate(v.date).split("،")[0], v.date, v.time, S.persons[v.personId]?.name, priestName(v.priestId), churchName(v.churchId)].map(q).join(",")));
    const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a2 = document.createElement("a"); a2.href = URL.createObjectURL(blob);
    a2.download = `visits-${ymd(new Date())}.csv`; a2.click(); URL.revokeObjectURL(a2.href);
  }
}

$app.addEventListener("change", e => {
  if (e.target.id === "imp-file") run(() => parseImport(e.target.files[0]));
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

$app.addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  run(() => act(b.dataset.act, b.dataset));
});
$app.addEventListener("input", e => {
  if (e.target.dataset.pfilter) return fillPersons(e.target.value);
  const f = e.target.dataset.filter; if (!f) return;
  const q = e.target.value.trim();
  document.querySelectorAll("#" + f + " tr").forEach(tr => { tr.hidden = !!q && !norm(tr.textContent).includes(norm(q)); });
});
