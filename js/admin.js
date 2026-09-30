function switchAdminTab(tab) {
  ["overview", "links"].forEach((t) => {
    document.getElementById(`adminTab-${t}`).classList.toggle("hidden", t !== tab);
    document.getElementById(`adminTabBtn-${t}`).classList.toggle("active", t === tab);
  });
}

async function renderAdminDashboard() {
  showView("view-admin");
  switchAdminTab("overview");
  await refreshAdminDashboard();
}

// Fetches weekly_plans for one term/week and returns completion stats.
// Reused by the main dashboard render AND by the weekly trend mini-chart.
async function calcCompletionForWeek(year, term, week, totalGrades) {
  const { data: plans, error } = await sb
    .from("weekly_plans")
    .select("*")
    .eq("academic_year", year)
    .eq("term", term)
    .eq("week_number", week);
  if (error) { console.error(error); return { plans: [], filled: {}, totalCells: 0, completedCells: 0, pct: 0 }; }

  const filled = {};
  (plans || []).forEach((p) => {
    const hasContent =
      (p.classwork || "").trim() ||
      (p.homework || "").trim() ||
      (p.items_required || "").trim() ||
      (p.tests_quizzes || "").trim();
    if (!hasContent) return;
    filled[p.department_id] = filled[p.department_id] || {};
    filled[p.department_id][p.grade_level] = filled[p.department_id][p.grade_level] || new Set();
    filled[p.department_id][p.grade_level].add(p.day_code);
  });

  let totalCells = 0, completedCells = 0;
  STATE.departments.forEach((d) => {
    for (let g = 1; g <= totalGrades; g++) {
      totalCells++;
      const daysDone = (filled[d.id] && filled[d.id][g]) ? filled[d.id][g].size : 0;
      if (daysDone >= d.days_per_week) completedCells++;
    }
  });
  const pct = totalCells ? Math.round((completedCells / totalCells) * 100) : 0;
  return { plans: plans || [], filled, totalCells, completedCells, pct };
}

async function refreshAdminDashboard() {
  const term = parseInt(document.getElementById("adminTermSelect").value);
  const week = parseInt(document.getElementById("adminWeekInput").value);
  const year = STATE.settings.academic_year || "2026-2027";
  const totalGrades = parseInt(STATE.settings.total_grades || "10");

  const { plans, filled, totalCells, completedCells, pct } =
    await calcCompletionForWeek(year, term, week, totalGrades);

  // ---- KPI cards ----
  document.getElementById("kpiProgressBar").style.width = pct + "%";
  document.getElementById("kpiPercentText").innerText = pct + "%";
  document.getElementById("kpiCompletedText").innerText = completedCells;
  document.getElementById("kpiPendingText").innerText = totalCells - completedCells;

  // ---- Status matrix ----
  const thead = document.querySelector("#matrixTable thead");
  const tbody = document.querySelector("#matrixTable tbody");
  thead.innerHTML =
    "<tr><th class='text-start p-2'>Grade</th>" +
    STATE.departments
      .map((d) => `<th class="p-2 text-center" style="color:${d.theme_color}">${escapeHtml(d.department_name)}</th>`)
      .join("") +
    "</tr>";

  let rowsHtml = "";
  for (let g = 1; g <= totalGrades; g++) {
    rowsHtml += `<tr class="border-t"><td class="p-2 font-medium">Grade ${g}</td>`;
    STATE.departments.forEach((d) => {
      const daysDone = (filled[d.id] && filled[d.id][g]) ? filled[d.id][g].size : 0;
      const isDone = daysDone >= d.days_per_week;
      rowsHtml += `<td class="p-2 text-center">
        <span class="px-2 py-1 rounded-full text-xs font-medium ${isDone ? "badge-done" : "badge-pending"}">
          ${isDone ? "✔ تم" : `${daysDone}/${d.days_per_week}`}
        </span>
      </td>`;
    });
    rowsHtml += "</tr>";
  }
  tbody.innerHTML = rowsHtml;

  // ---- Per-department breakdown ----
  const deptStats = STATE.departments.map((d) => {
    let done = 0;
    for (let g = 1; g <= totalGrades; g++) {
      const daysDone = (filled[d.id] && filled[d.id][g]) ? filled[d.id][g].size : 0;
      if (daysDone >= d.days_per_week) done++;
    }
    const lastUpdate = (plans || [])
      .filter((p) => p.department_id === d.id)
      .reduce((max, p) => (p.updated_at > max ? p.updated_at : max), "");
    return { dept: d, done, total: totalGrades, pct: totalGrades ? Math.round((done / totalGrades) * 100) : 0, lastUpdate };
  }).sort((a, b) => a.pct - b.pct);

  document.getElementById("deptStatsList").innerHTML = deptStats
    .map((s) => `
      <div>
        <div class="flex justify-between text-xs mb-1">
          <span class="font-medium" style="color:${s.dept.theme_color}">${escapeHtml(s.dept.department_name)}</span>
          <span class="text-slate-400">${s.done}/${s.total} — ${s.lastUpdate ? new Date(s.lastUpdate).toLocaleString('ar-EG') : "لا يوجد إدخال"}</span>
        </div>
        <div class="w-full bg-slate-100 rounded-full h-2">
          <div class="h-2 rounded-full" style="width:${s.pct}%; background:${s.dept.theme_color}"></div>
        </div>
      </div>`)
    .join("");

  // ---- Weekly trend (last up to 6 weeks) ----
  renderWeeklyTrend(year, term, week, totalGrades);

  // ---- Smart weekly links panel ----
  await loadAccessLinksForCurrentWeek(year, term, week);

  STATE._lastPlans = plans || [];
  STATE._lastTerm = term;
  STATE._lastWeek = week;
}

async function renderWeeklyTrend(year, term, currentWeek, totalGrades) {
  const startWeek = Math.max(1, currentWeek - 5);
  const weeks = [];
  for (let w = startWeek; w <= currentWeek; w++) weeks.push(w);

  const results = await Promise.all(
    weeks.map((w) => calcCompletionForWeek(year, term, w, totalGrades))
  );

  const bars = document.getElementById("weeklyTrendChart");
  const labels = document.getElementById("weeklyTrendLabels");
  bars.innerHTML = results
    .map((r, i) => `
      <div class="flex-1 flex flex-col items-center justify-end h-full">
        <span class="text-[10px] text-slate-500 mb-1">${r.pct}%</span>
        <div class="w-full bg-blue-500 rounded-t" style="height:${Math.max(4, r.pct)}%"></div>
      </div>`)
    .join("");
  labels.style.gridTemplateColumns = `repeat(${weeks.length}, 1fr)`;
  labels.innerHTML = weeks.map((w) => `<span class="text-center">W${w}</span>`).join("");
}

/* ------------------------- SMART WEEKLY LINKS ------------------------- */
async function loadAccessLinksForCurrentWeek(year, term, week) {
  const { data, error } = await sb
    .from("access_links")
    .select("*")
    .eq("academic_year", year)
    .eq("term", term)
    .eq("week_number", week);
  if (error) { console.error(error); STATE._currentLinks = []; }
  else STATE._currentLinks = data || [];
  renderLinksPanel();
}

function renderLinksPanel() {
  const wrap = document.getElementById("linksList");
  const byDept = Object.fromEntries(STATE._currentLinks.map((l) => [l.department_id, l]));

  const headLine = (d) => {
    if (!d.head_name) return "";
    return `<div class="text-xs text-slate-400">${escapeHtml(d.head_name)}${d.specialization ? " — " + escapeHtml(d.specialization) : ""}${!d.whatsapp_number ? " · ⚠ لا يوجد رقم واتساب محفوظ" : ""}</div>`;
  };

  wrap.innerHTML = STATE.departments
    .map((d) => {
      const link = byDept[d.id];
      if (!link) {
        return `
        <div class="flex items-center justify-between border rounded-lg p-3 text-sm gap-2">
          <div>
            <span class="font-medium" style="color:${d.theme_color}">${escapeHtml(d.department_name)}</span>
            ${headLine(d)}
          </div>
          <button onclick="regenerateLink(${d.id})" class="text-blue-600 hover:underline text-sm min-h-[40px] px-2">+ إنشاء رابط لهذا الأسبوع</button>
        </div>`;
      }
      const url = `${baseAppUrl()}?token=${link.token}`;
      return `
      <div class="border rounded-lg p-3 text-sm">
        <div class="flex items-center gap-2 mb-1">
          <span class="w-2 h-2 rounded-full inline-block shrink-0" style="background:${d.theme_color}"></span>
          <span class="font-medium">${escapeHtml(d.department_name)}</span>
          ${!link.is_active ? '<span class="text-[10px] bg-slate-200 rounded px-1">معطّل</span>' : ""}
        </div>
        <div class="mb-2">${headLine(d)}</div>
        <input readonly value="${url}" class="w-full border rounded p-2 text-xs mb-2" onclick="this.select()"/>
        <div class="grid grid-cols-4 gap-1">
          <button onclick="copyLink('${url}')" class="bg-slate-200 hover:bg-slate-300 rounded px-1 py-2 text-xs min-h-[40px]">نسخ</button>
          <button onclick="shareWhatsapp('${url}', '${escapeHtml(d.department_name)}', '${d.whatsapp_number || ""}')" class="bg-green-100 hover:bg-green-200 text-green-700 rounded px-1 py-2 text-xs min-h-[40px]">واتساب</button>
          <button onclick="regenerateLink(${d.id})" class="bg-amber-100 hover:bg-amber-200 text-amber-700 rounded px-1 py-2 text-xs min-h-[40px]">تجديد</button>
          <button onclick="toggleLinkActive(${link.id}, ${!link.is_active})" class="bg-red-100 hover:bg-red-200 text-red-700 rounded px-1 py-2 text-xs min-h-[40px]">${link.is_active ? "تعطيل" : "تفعيل"}</button>
        </div>
      </div>`;
    })
    .join("");
}

// Bulk: create a link only for departments that don't already have one this week
async function generateWeekLinks() {
  const btn = document.getElementById("generateLinksBtn");
  await runWithLoading(btn, "جاري التوليد... / Generating...", async () => {
  const term = parseInt(document.getElementById("adminTermSelect").value);
  const week = parseInt(document.getElementById("adminWeekInput").value);
  const year = STATE.settings.academic_year || "2026-2027";

  const existingDeptIds = new Set(STATE._currentLinks.map((l) => l.department_id));
  const missing = STATE.departments.filter((d) => !existingDeptIds.has(d.id));
  if (missing.length === 0) {
    alert("كل الأقسام لديها رابط بالفعل لهذا الأسبوع / All departments already have a link this week.");
    return;
  }

  const rows = missing.map((d) => ({
    token: makeToken(),
    department_id: d.id,
    academic_year: year,
    term,
    week_number: week,
  }));

  const { error } = await sb.from("access_links").insert(rows);
  if (error) { alert(error.message); return; }
  await loadAccessLinksForCurrentWeek(year, term, week);
  });
}

// Single: force a brand-new token for one department (invalidates the old link)
async function regenerateLink(deptId) {
  const proceed = confirm(
    "تجديد الرابط سيُبطل الرابط القديم فوراً إن وُجد.\nهل تريد المتابعة؟\n\n" +
    "Renewing will immediately invalidate the old link, if any. Continue?"
  );
  if (!proceed) return;

  const term = parseInt(document.getElementById("adminTermSelect").value);
  const week = parseInt(document.getElementById("adminWeekInput").value);
  const year = STATE.settings.academic_year || "2026-2027";

  const { error } = await sb.from("access_links").upsert(
    {
      token: makeToken(),
      department_id: deptId,
      academic_year: year,
      term,
      week_number: week,
      is_active: true,
    },
    { onConflict: "department_id,academic_year,term,week_number" }
  );
  if (error) { alert(error.message); return; }
  await loadAccessLinksForCurrentWeek(year, term, week);
}

async function toggleLinkActive(linkId, newState) {
  const { error } = await sb.from("access_links").update({ is_active: newState }).eq("id", linkId);
  if (error) { alert(error.message); return; }
  const term = parseInt(document.getElementById("adminTermSelect").value);
  const week = parseInt(document.getElementById("adminWeekInput").value);
  const year = STATE.settings.academic_year || "2026-2027";
  await loadAccessLinksForCurrentWeek(year, term, week);
}

function copyLink(url) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => alert("تم نسخ الرابط / Link copied"));
  } else {
    prompt("انسخ الرابط يدوياً / Copy manually:", url);
  }
}

function shareWhatsapp(url, deptName, phone) {
  const text = `رابط إدخال الخطة الأسبوعية — ${deptName}:\n${url}`;
  const digitsOnly = (phone || "").replace(/[^\d]/g, ""); // wa.me wants digits only, no + or spaces
  const target = digitsOnly ? `https://wa.me/${digitsOnly}` : "https://wa.me/";
  return window.open(target + "?text=" + encodeURIComponent(text), "_blank");
}

// Bulk: opens a WhatsApp chat (pre-filled) for every department that has
// BOTH an active link this week AND a saved WhatsApp number. Browsers may
// block opening several tabs at once from one click — we stagger them
// slightly and tell the admin to allow pop-ups for this site if needed.
// Opens a list of real, individually-tappable WhatsApp links — one per
// department that has BOTH an active link this week AND a saved WhatsApp
// number. We deliberately do NOT try to auto-open them all via window.open:
// browsers (and mobile OSes especially) block automatic multi-popup/app
// launches, so a genuine tap per link is the only approach that reliably
// works on both mobile and desktop.
function sendAllLinksWhatsapp() {
  const byDept = Object.fromEntries(STATE._currentLinks.map((l) => [l.department_id, l]));

  const ready = STATE.departments.filter((d) => byDept[d.id] && byDept[d.id].is_active && d.whatsapp_number);
  const skipped = STATE.departments.filter((d) => !(byDept[d.id] && byDept[d.id].is_active && d.whatsapp_number));

  if (ready.length === 0) {
    alert(
      "لا يوجد أي قسم لديه رابط فعّال لهذا الأسبوع + رقم واتساب محفوظ في نفس الوقت.\n" +
      "تأكد من توليد الروابط أولاً، ومن حفظ رقم واتساب لكل رئيس قسم من نافذة إدارة المواد."
    );
    return;
  }

  const listEl = document.getElementById("sendQueueList");
  STATE._sendQueueTexts = {}; // deptId -> { text, phone } for the copy-fallback button

  listEl.innerHTML = ready
    .map((d) => {
      const link = byDept[d.id];
      const url = `${baseAppUrl()}?token=${link.token}`;
      const text = `رابط إدخال الخطة الأسبوعية — ${d.department_name}:\n${url}`;
      const digitsOnly = d.whatsapp_number.replace(/[^\d]/g, "");
      const waHref = `https://wa.me/${digitsOnly}?text=${encodeURIComponent(text)}`;
      STATE._sendQueueTexts[d.id] = { text, phone: d.whatsapp_number };

      return `
      <div id="sendQueueRow-${d.id}" class="border rounded-lg p-3 text-sm">
        <div class="mb-2">
          <div class="font-medium" style="color:${d.theme_color}">${escapeHtml(d.department_name)}</div>
          <div class="text-xs text-slate-400">${escapeHtml(d.head_name || "")} ${d.whatsapp_number ? "· " + escapeHtml(d.whatsapp_number) : ""}</div>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <a href="${waHref}" target="_blank" rel="noopener"
             onclick="markSendQueueRowSent(${d.id})"
             class="bg-green-600 hover:bg-green-700 text-white rounded-lg px-2 py-2 text-sm font-medium min-h-[40px] inline-flex items-center justify-center text-center">
            📤 فتح واتساب
          </a>
          <button onclick="copySendQueueMessage(${d.id})"
             class="bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg px-2 py-2 text-sm font-medium min-h-[40px]">
            📋 نسخ الرسالة
          </button>
        </div>
      </div>`;
    })
    .join("");

  const skippedEl = document.getElementById("sendQueueSkipped");
  skippedEl.innerHTML =
    skipped.length > 0
      ? "تم تخطي (بدون رابط فعّال أو بدون رقم واتساب محفوظ): " +
        skipped.map((d) => escapeHtml(d.department_name)).join("، ")
      : "";

  document.getElementById("sendQueueModal").classList.remove("hidden");
}

// Greys out a row once tapped, so the admin can see progress while
// tapping down the list (purely visual — the link itself still works if tapped again).
function markSendQueueRowSent(deptId) {
  const row = document.getElementById(`sendQueueRow-${deptId}`);
  if (!row) return;
  row.classList.add("opacity-50");
  const link = row.querySelector("a");
  if (link) link.innerHTML = "✔ تم الفتح";
}

// Fallback for when WhatsApp isn't installed/available on the admin's own
// device: copies the phone number + ready-made message so it can be pasted
// into SMS, Telegram, email, or any other app to reach the department head.
function copySendQueueMessage(deptId) {
  const entry = STATE._sendQueueTexts && STATE._sendQueueTexts[deptId];
  if (!entry) return;
  const combined = `${entry.phone}\n\n${entry.text}`;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(combined).then(() => alert("تم نسخ الرقم والرسالة / Number and message copied"));
  } else {
    prompt("انسخ يدوياً / Copy manually:", combined);
  }
}

/* ------------------------- SETTINGS MODAL ------------------------- */
function openSettingsModal() {
  document.getElementById("setSchoolNameAr").value  = STATE.settings.school_name_ar    || "";
  document.getElementById("setSchoolNameEn").value  = STATE.settings.school_name_en    || "";
  document.getElementById("setLogoUrl").value        = STATE.settings.school_logo_url   || "";
  document.getElementById("setTotalGrades").value   = STATE.settings.total_grades      || "10";
  document.getElementById("setAcademicYear").value  = STATE.settings.academic_year     || "";
  document.getElementById("setSchoolStartDate").value = STATE.settings.school_start_date || "";
  document.getElementById("newAdminPin").value       = "";

  // Show live preview of week 1 dates if start date already set
  _updateStartDatePreview();
  document.getElementById("settingsModal").classList.remove("hidden");
}

function _updateStartDatePreview() {
  const val = document.getElementById("setSchoolStartDate").value;
  const preview = document.getElementById("startDatePreview");
  const text = document.getElementById("startDatePreviewText");
  if (!val) { preview.classList.add("hidden"); return; }
  // Temporarily set STATE.settings to compute preview
  const prev = STATE.settings.school_start_date;
  STATE.settings.school_start_date = val;
  const range = weekDateRange(1);
  STATE.settings.school_start_date = prev;
  if (range) {
    text.textContent = `${range.fromAr} — ${range.toAr}`;
    preview.classList.remove("hidden");
  }
}

async function saveSettings() {
  const updates = {
    school_name_ar:    document.getElementById("setSchoolNameAr").value.trim(),
    school_name_en:    document.getElementById("setSchoolNameEn").value.trim(),
    school_logo_url:   document.getElementById("setLogoUrl").value.trim(),
    total_grades:      document.getElementById("setTotalGrades").value.trim(),
    academic_year:     document.getElementById("setAcademicYear").value.trim(),
    school_start_date: document.getElementById("setSchoolStartDate").value.trim(),
  };

  const rows = Object.entries(updates).map(([setting_key, setting_value]) => ({
    setting_key,
    setting_value,
  }));

  const { error } = await sb.from("school_settings").upsert(rows, { onConflict: "setting_key" });
  if (error) {
    alert("خطأ / Error: " + error.message);
    return;
  }
  await loadSettings();
  applyBranding();
  closeModal("settingsModal");
  refreshAdminDashboard();
}

/* ====================== DAYS MANAGER ====================== */
function openDaysManagerModal() {
  const totalGrades = parseInt(STATE.settings.total_grades || "10");
  let html = `<div class="overflow-x-auto">
    <table class="w-full text-sm border-collapse">
      <thead>
        <tr class="bg-slate-100">
          <th class="text-start p-2 border">المادة / Subject</th>
          <th class="text-start p-2 border">الفرع / Branch</th>
          <th class="text-center p-2 border w-28">الأيام / Days</th>
          <th class="text-start p-2 border">نطاق الصفوف / Grade Range</th>
        </tr>
      </thead>
      <tbody>`;

  STATE.departments.forEach((d) => {
    const subs = STATE.subSubjects.filter((s) => s.department_id === d.id);

    if (subs.length === 0) {
      // Department with no branches — edit department days_per_week directly
      html += `<tr class="border-t hover:bg-slate-50">
        <td class="p-2 border font-medium" style="border-left: 3px solid ${d.theme_color}">
          ${escapeHtml(d.department_name)}
        </td>
        <td class="p-2 border text-slate-400 text-xs">—</td>
        <td class="p-2 border text-center">
          <div class="flex items-center justify-center gap-1">
            ${[1,2,3,4,5].map(n => `
              <button onclick="setDeptDaysVisual(${d.id}, ${n}, this)"
                class="days-dot w-7 h-7 rounded-full text-xs font-medium border transition-colors
                       ${d.days_per_week >= n ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-400 border-slate-300"}"
                data-dept="${d.id}" data-n="${n}">
                ${n}
              </button>`).join("")}
          </div>
        </td>
        <td class="p-2 border text-slate-400 text-xs">كل الصفوف</td>
      </tr>`;
    } else {
      // Department with branches — show each branch as a row
      subs.forEach((s, i) => {
        const gradeLabel = s.grade_from && s.grade_to
          ? `${s.grade_from} → ${s.grade_to}`
          : s.grade_from ? `≥ ${s.grade_from}`
          : s.grade_to   ? `≤ ${s.grade_to}`
          : "كل الصفوف";

        html += `<tr class="border-t hover:bg-slate-50">
          <td class="p-2 border font-medium" style="border-left: 3px solid ${d.theme_color}">
            ${i === 0 ? escapeHtml(d.department_name) : ""}
          </td>
          <td class="p-2 border text-sm">${escapeHtml(s.name)}</td>
          <td class="p-2 border text-center">
            <div class="flex items-center justify-center gap-1">
              ${[1,2,3,4,5].map(n => `
                <button onclick="setSubDaysVisual(${s.id}, ${n}, this)"
                  class="days-dot w-7 h-7 rounded-full text-xs font-medium border transition-colors
                         ${s.days_per_week >= n ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-400 border-slate-300"}"
                  data-sub="${s.id}" data-n="${n}">
                  ${n}
                </button>`).join("")}
            </div>
          </td>
          <td class="p-2 border text-xs text-slate-500">${gradeLabel}</td>
        </tr>`;
      });
    }
  });

  html += `</tbody></table></div>
    <div class="text-xs text-slate-400 mt-3">
      💡 اضغط الرقم لتحديد عدد أيام النصاب — الأرقام الزرقاء تمثل الأيام المفعّلة
    </div>`;

  document.getElementById("daysManagerTable").innerHTML = html;
  document.getElementById("daysManagerModal").classList.remove("hidden");
}

async function setDeptDaysVisual(deptId, days, btn) {
  const { error } = await sb.from("departments").update({ days_per_week: days }).eq("id", deptId);
  if (error) { alert(error.message); return; }
  await loadDepartments();
  // Refresh dots in the row
  document.querySelectorAll(`[data-dept="${deptId}"]`).forEach((b) => {
    const n = parseInt(b.dataset.n);
    if (n <= days) {
      b.classList.add("bg-blue-600", "text-white", "border-blue-600");
      b.classList.remove("bg-white", "text-slate-400", "border-slate-300");
    } else {
      b.classList.remove("bg-blue-600", "text-white", "border-blue-600");
      b.classList.add("bg-white", "text-slate-400", "border-slate-300");
    }
  });
}

async function setSubDaysVisual(subId, days, btn) {
  const { error } = await sb.from("sub_subjects").update({ days_per_week: days }).eq("id", subId);
  if (error) { alert(error.message); return; }
  await loadSubSubjects();
  // Refresh dots in the row
  document.querySelectorAll(`[data-sub="${subId}"]`).forEach((b) => {
    const n = parseInt(b.dataset.n);
    if (n <= days) {
      b.classList.add("bg-blue-600", "text-white", "border-blue-600");
      b.classList.remove("bg-white", "text-slate-400", "border-slate-300");
    } else {
      b.classList.remove("bg-blue-600", "text-white", "border-blue-600");
      b.classList.add("bg-white", "text-slate-400", "border-slate-300");
    }
  });
}

async function changeAdminPin() {
  const newPin = document.getElementById("newAdminPin").value.trim();
  if (!/^\d{4}$/.test(newPin)) {
    alert("يجب أن يتكون الرمز من 4 أرقام بالضبط");
    return;
  }
  if (!STATE._adminPin) {
    alert("انتهت جلسة الأدمن، أعد تسجيل الدخول / Admin session expired, please log in again.");
    logout();
    return;
  }
  const { data, error } = await sb.rpc("admin_update_admin_pin", {
    p_current_pin: STATE._adminPin,
    p_new_pin: newPin,
  });
  if (error || !data) {
    alert("تعذر تغيير الرمز / Could not change PIN");
    return;
  }
  STATE._adminPin = newPin;
  document.getElementById("newAdminPin").value = "";
  alert("تم تغيير رمز الأدمن بنجاح / Admin PIN changed successfully");
}

/* ------------------------- MANAGE DEPARTMENTS ------------------------- */
function openManageModal() {
  renderManageList();
  document.getElementById("manageModal").classList.remove("hidden");
}

function renderManageList() {
  const wrap = document.getElementById("manageDeptList");
  const totalGrades = parseInt(STATE.settings.total_grades || "10");

  const gradeRangeLabel = (s) => {
    if (s.grade_from == null && s.grade_to == null) return "";
    const from = s.grade_from ?? 1;
    const to = s.grade_to ?? totalGrades;
    return from === to ? ` (Grade ${from})` : ` (Grade ${from}-${to})`;
  };

  wrap.innerHTML = STATE.departments
    .map((d) => {
      const subs = STATE.subSubjects.filter((s) => s.department_id === d.id);
      return `
      <div class="border rounded-lg p-3">
        <div class="flex items-center justify-between flex-wrap gap-2">
          <div class="flex items-center gap-2">
            <span class="w-3 h-3 rounded-full inline-block" style="background:${d.theme_color}"></span>
            <b>${escapeHtml(d.department_name)}</b>
            <span class="text-slate-400 text-xs">(${escapeHtml(d.department_code)})</span>
          </div>
          <div class="flex items-center gap-2 text-sm">
            <label class="text-slate-500">Days/wk</label>
            <input type="number" min="1" max="5" value="${d.days_per_week}"
              class="w-14 border rounded p-1"
              onchange="updateDeptDays(${d.id}, this.value)"/>
            <button onclick="changeDepartmentPin(${d.id}, '${escapeHtml(d.department_name)}')" class="text-indigo-600 hover:underline min-h-[40px] px-1">تغيير PIN</button>
            <button onclick="deleteDepartment(${d.id})" class="text-red-500 hover:underline min-h-[40px] px-1">حذف</button>
          </div>
        </div>
        <div class="mt-2 flex flex-wrap gap-2">
          ${subs
            .map(
              (s) =>
                `<span class="bg-slate-100 rounded-lg px-2 py-1 text-xs flex items-center gap-1">
                  <span>${escapeHtml(s.name)}${gradeRangeLabel(s)}</span>
                  <span class="text-slate-400 mx-1">|</span>
                  <label class="text-slate-500">أيام:</label>
                  <input type="number" min="1" max="5" value="${s.days_per_week}"
                    class="w-10 border rounded p-0.5 text-center text-xs"
                    onchange="updateSubDays(${s.id}, this.value)"
                    title="عدد أيام نصاب ${escapeHtml(s.name)} أسبوعياً"/>
                  <button onclick="deleteSubSubject(${s.id})" class="text-red-400 inline-flex items-center justify-center min-w-[28px] min-h-[28px]">✕</button>
                </span>`
            )
            .join("")}
        </div>
        <div class="mt-2 grid grid-cols-2 sm:grid-cols-6 gap-2 items-center">
          <input id="newSubName-${d.id}" placeholder="اسم الفرع" class="border rounded-lg p-2 text-sm col-span-2"/>
          <input id="newSubDays-${d.id}" type="number" min="1" max="5" value="5" placeholder="أيام" class="border rounded-lg p-2 text-sm" title="عدد أيام النصاب"/>
          <input id="newSubFrom-${d.id}" type="number" min="1" max="${totalGrades}" placeholder="من صف" class="border rounded-lg p-2 text-sm"/>
          <input id="newSubTo-${d.id}" type="number" min="1" max="${totalGrades}" placeholder="إلى صف" class="border rounded-lg p-2 text-sm"/>
          <button onclick="addSubSubjectFromForm(${d.id})" class="bg-indigo-600 text-white rounded-lg px-2 py-2 text-xs min-h-[40px]">+ إضافة</button>
        </div>
        <div class="text-[10px] text-slate-400 mt-1">اترك "من صف" و"إلى صف" فارغين ليظهر الفرع لكل الصفوف</div>
        <div class="mt-3 pt-3 border-t">
          <div class="text-xs text-slate-500 mb-1">👤 بيانات رئيس القسم / Department Head</div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
            <input id="headName-${d.id}" placeholder="الاسم / Name" value="${escapeHtml(d.head_name || "")}" class="border rounded-lg p-2 text-sm"/>
            <input id="headSpec-${d.id}" placeholder="التخصص / Specialization" value="${escapeHtml(d.specialization || "")}" class="border rounded-lg p-2 text-sm"/>
            <input id="headWhatsapp-${d.id}" placeholder="واتساب مثال: 9665xxxxxxxx" value="${escapeHtml(d.whatsapp_number || "")}" class="border rounded-lg p-2 text-sm" dir="ltr"/>
          </div>
          <button onclick="saveDepartmentHead(${d.id})" class="text-sm bg-slate-700 hover:bg-slate-800 text-white rounded-lg px-3 py-2 min-h-[40px]">💾 حفظ بيانات المسؤول</button>
        </div>
      </div>`;
    })
    .join("");
}

async function saveDepartmentHead(deptId) {
  const head_name = document.getElementById(`headName-${deptId}`).value.trim();
  const specialization = document.getElementById(`headSpec-${deptId}`).value.trim();
  const whatsapp_number = document.getElementById(`headWhatsapp-${deptId}`).value.trim();

  const { error } = await sb
    .from("departments")
    .update({ head_name, specialization, whatsapp_number })
    .eq("id", deptId);

  if (error) {
    alert("تعذر الحفظ / Could not save: " + error.message);
    return;
  }
  await loadDepartments();
  renderManageList();
  if (STATE._currentLinks) renderLinksPanel(); // reflect new head info/whatsapp number in the links tab too
}

async function changeDepartmentPin(deptId, deptName) {
  if (!STATE._adminPin) {
    alert("انتهت جلسة الأدمن، أعد تسجيل الدخول / Admin session expired, please log in again.");
    logout();
    return;
  }
  const newPin = prompt(`رمز PIN جديد لمادة ${deptName} (4 أرقام):`);
  if (!newPin) return;
  if (!/^\d{4}$/.test(newPin)) {
    alert("يجب أن يتكون الرمز من 4 أرقام بالضبط");
    return;
  }
  const { data, error } = await sb.rpc("admin_update_department_pin", {
    p_admin_pin: STATE._adminPin,
    p_department_id: deptId,
    p_new_pin: newPin,
  });
  if (error || !data) {
    alert("تعذر تغيير الرمز / Could not change PIN");
    return;
  }
  alert("تم تغيير الرمز بنجاح / PIN changed successfully");
}

async function updateDeptDays(deptId, value) {
  const days = parseInt(value);
  const { error } = await sb.from("departments").update({ days_per_week: days }).eq("id", deptId);
  if (error) { alert(error.message); return; }
  await loadDepartments();
  refreshAdminDashboard();
}

async function deleteDepartment(deptId) {
  if (!confirm("هل أنت متأكد من حذف هذه المادة؟ سيتم حذف كل بياناتها.")) return;
  const { error } = await sb.from("departments").delete().eq("id", deptId);
  if (error) { alert(error.message); return; }
  await loadDepartments();
  await loadSubSubjects();
  renderManageList();
  refreshAdminDashboard();
}

async function addSubSubjectFromForm(deptId) {
  const nameEl = document.getElementById(`newSubName-${deptId}`);
  const daysEl = document.getElementById(`newSubDays-${deptId}`);
  const fromEl = document.getElementById(`newSubFrom-${deptId}`);
  const toEl   = document.getElementById(`newSubTo-${deptId}`);

  const name = nameEl.value.trim();
  const fromVal = fromEl.value.trim();
  const toVal   = toEl.value.trim();
  const days_per_week = daysEl ? Math.min(5, Math.max(1, parseInt(daysEl.value) || 5)) : 5;

  if (!name) {
    alert("يرجى إدخال اسم الفرع / Please enter a branch name");
    return;
  }
  const grade_from = fromVal ? parseInt(fromVal) : null;
  const grade_to   = toVal   ? parseInt(toVal)   : null;
  if (grade_from != null && grade_to != null && grade_from > grade_to) {
    alert('قيمة "من صف" يجب ألا تكون أكبر من "إلى صف" / "From" must not be greater than "To"');
    return;
  }

  const { error } = await sb
    .from("sub_subjects")
    .insert({ department_id: deptId, name, days_per_week, grade_from, grade_to });
  if (error) { alert(error.message); return; }

  nameEl.value = "";
  if (daysEl) daysEl.value = "5";
  fromEl.value = "";
  toEl.value   = "";
  await loadSubSubjects();
  renderManageList();
}

async function updateSubDays(subId, value) {
  const days = Math.min(5, Math.max(1, parseInt(value) || 5));
  const { error } = await sb
    .from("sub_subjects")
    .update({ days_per_week: days })
    .eq("id", subId);
  if (error) { alert(error.message); return; }
  await loadSubSubjects();
}

async function deleteSubSubject(subId) {
  if (!confirm("حذف هذا الفرع؟")) return;
  const { error } = await sb.from("sub_subjects").delete().eq("id", subId);
  if (error) { alert(error.message); return; }
  await loadSubSubjects();
  renderManageList();
}

async function addDepartment() {
  const code = document.getElementById("newDeptCode").value.trim().toUpperCase();
  const name = document.getElementById("newDeptName").value.trim();
  const pin = document.getElementById("newDeptPin").value.trim();
  const color = document.getElementById("newDeptColor").value;
  const days = parseInt(document.getElementById("newDeptDays").value) || 5;

  if (!code || !name || pin.length !== 4) {
    alert("يرجى تعبئة كل الحقول بشكل صحيح (PIN من 4 أرقام)");
    return;
  }
  if (!STATE._adminPin) {
    alert("انتهت جلسة الأدمن، أعد تسجيل الدخول / Admin session expired, please log in again.");
    logout();
    return;
  }

  const { error } = await sb.rpc("admin_create_department", {
    p_admin_pin: STATE._adminPin,
    p_department_code: code,
    p_department_name: name,
    p_pin: pin,
    p_theme_color: color,
    p_days_per_week: days,
    p_sort_order: STATE.departments.length + 1,
  });
  if (error) { alert(error.message); return; }

  document.getElementById("newDeptCode").value = "";
  document.getElementById("newDeptName").value = "";
  document.getElementById("newDeptPin").value = "";

  await loadDepartments();
  renderManageList();
  refreshAdminDashboard();
}

/* ------------------------- EXPORT EXCEL ------------------------- */
