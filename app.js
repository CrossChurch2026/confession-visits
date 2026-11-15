import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
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
  $app.innerHTML = header() +
    `<nav>${tabs.map(([k, v]) => `<button class="${S.tab === k ? "on" : ""}" data-act="tab" data-v="${k}">${v}</button>`).join("")}</nav>` +
    `<main><div class="msg" id="msg">${esc(S.msg)}</div>${views[S.tab]()}</main>`;
}
function header() {
  return `<header><div><strong>سجل زيارات الاعتراف</strong>
    <small>${S.me ? esc(S.me.name) + " — " + ROLES[S.me.role] : ""}</small></div>
    ${S.user ? '<button class="sec" data-act="logout">تسجيل الخروج</button>' : ""}</header>`;
}
function loginView() {
  return `<div class="login"><div class="card">
    <h2 class="center" style="padding:0">سجل زيارات الاعتراف</h2>
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
      ${canEdit() ? `<td><button class="danger" data-act="del-visit" data-id="${esc(id)}">حذف</button></td>` : ""}</tr>`).join("");
  return `<div class="card"><h3>تسجيل زيارة</h3><div class="row">
      <label>الشخص<select id="v-person"><option value="">اختر…</option>${personOpts()}</select></label>
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
  const add = canEdit() ? `<div class="card"><h3>إضافة شخص (مرة واحدة)</h3><div class="row">
      <label>الاسم<input id="p-name"></label>
      <label>الهاتف (اختياري)<input id="p-phone" dir="ltr"></label>
      <label>العنوان (اختياري)<input id="p-address"></label>
      ${role() === "priest" ? "" : `<label>الأب الكاهن<select id="p-priest"><option value="">اختر…</option>${priestOpts("", role() === "admin")}</select></label>`}
      <button data-act="add-person">إضافة</button></div></div>` : "";
  const rows = Object.entries(S.persons).sort(byName).map(([id, p]) => {
    const vs = visitsOf(id);
    return `<tr><td>${esc(p.name)}</td><td>${esc(p.address || "—")}</td>${showPriest() ? `<td>${esc(priestName(p.priestId))}</td>` : ""}
      <td>${vs.length}</td><td>${vs[0] ? esc(fmtDate(vs[0][1].date)) : "—"}</td>
      <td><button class="sec" data-act="detail" data-id="${esc(id)}">السجل</button>
      ${canEdit() ? ` <button class="danger" data-act="del-person" data-id="${esc(id)}">حذف</button>` : ""}</td></tr>`;
  }).join("");
  let detail = "";
  if (S.detail && S.persons[S.detail]) {
    const dp = S.persons[S.detail];
    detail = `<div class="card"><h3>زيارات: ${esc(dp.name)}</h3>
      <p style="color:var(--mute);margin:0 0 8px">${dp.address ? "العنوان: " + esc(dp.address) : ""}${dp.address && dp.phone ? " — " : ""}${dp.phone ? "الهاتف: " + esc(dp.phone) : ""}</p><table><tbody>` +
      (visitsOf(S.detail).map(([, v]) => `<tr><td>${esc(fmtDate(v.date))}</td><td>${esc(fmtTime(v.time))}</td></tr>`).join("") ||
       "<tr><td>لا توجد زيارات</td></tr>") + "</tbody></table></div>";
  }
  return add + `<div class="card"><div class="row"><h3 style="flex:1;margin:0">الأشخاص (${Object.keys(S.persons).length})</h3>
    <input data-filter="p-body" placeholder="بحث بالاسم…" style="max-width:220px"></div>
    <div class="tw"><table><thead><tr><th>الاسم</th><th>العنوان</th>${showPriest() ? "<th>الأب الكاهن</th>" : ""}<th>عدد الزيارات</th><th>آخر زيارة</th><th></th></tr></thead>
    <tbody id="p-body">${rows}</tbody></table></div></div>` + detail;
}

function priestsView() {
  const rows = Object.entries(S.priests).sort(byName).map(([id, p]) =>
    `<tr><td>${esc(p.name)}</td><td>${esc(churchName(p.churchId))}</td>
     <td><button class="danger" data-act="del-priest" data-id="${esc(id)}">حذف</button></td></tr>`).join("");
  return `<div class="card"><h3>إضافة أب كاهن</h3><div class="row">
    <label>الاسم<input id="pr-name"></label>
    ${role() === "admin" ? `<label>الكنيسة<select id="pr-church"><option value="">اختر…</option>${churchOpts("")}</select></label>` : ""}
    <button data-act="add-priest">إضافة</button></div></div>
    <div class="card"><div class="tw"><table><thead><tr><th>الاسم</th><th>الكنيسة</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function churchesView() {
  const rows = Object.entries(S.churches).sort(byName).map(([id, c]) =>
    `<tr><td>${esc(c.name)}</td><td><button class="danger" data-act="del-church" data-id="${esc(id)}">حذف</button></td></tr>`).join("");
  return `<div class="card"><h3>إضافة كنيسة</h3><div class="row">
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
    S.tab = d.v; S.msg = ""; S.detail = null;
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
    let priestId, churchId;
    if (role() === "priest") { priestId = S.me.priestId; churchId = S.me.churchId; }
    else { priestId = val("p-priest"); if (!priestId) return flash("اختر الأب الكاهن"); churchId = S.priests[priestId].churchId; }
    const dup = Object.values(S.persons).some(p => p.priestId === priestId && p.name === name);
    if (dup && !confirm("يوجد شخص بنفس الاسم عند هذا الأب. هل تريد الإضافة مرة أخرى؟")) return;
    const data = { name, phone: val("p-phone").trim(), address: val("p-address").trim(), priestId, churchId, createdAt: serverTimestamp() };
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

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

$app.addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  run(() => act(b.dataset.act, b.dataset));
});
$app.addEventListener("input", e => {
  const f = e.target.dataset.filter; if (!f) return;
  const q = e.target.value.trim();
  document.querySelectorAll("#" + f + " tr").forEach(tr => { tr.hidden = q && !tr.textContent.includes(q); });
});
