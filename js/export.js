function exportExcel() {
  const plans = STATE._lastPlans || [];
  const deptById = Object.fromEntries(STATE.departments.map((d) => [d.id, d]));
  const subById = Object.fromEntries(STATE.subSubjects.map((s) => [s.id, s]));

  const rows = plans.map((p) => ({
    Grade: p.grade_level,
    Department: deptById[p.department_id]?.department_name || "",
    "Sub-Subject": p.sub_subject_id ? (subById[p.sub_subject_id]?.name || "") : "",
    Day: p.day_code,
    Classwork: p.classwork,
    Homework: p.homework,
    "Items Required": p.items_required,
    "Tests & Quizzes": p.tests_quizzes,
  }));

  if (rows.length === 0) {
    alert("لا توجد بيانات لهذا الأسبوع / No data for this week");
    return;
  }

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `Term${STATE._lastTerm}_Week${STATE._lastWeek}`);
  XLSX.writeFile(wb, `WeeklyPlan_T${STATE._lastTerm}_W${STATE._lastWeek}.xlsx`);
}

/* ------------------------- PRINT / PDF PREVIEW ------------------------- */
function openPrintPreview() {
  const totalGrades = parseInt(STATE.settings.total_grades || "10");
  const gSel = document.getElementById("printGradeSelect");
  gSel.innerHTML =
    `<option value="all">📑 كل الصفوف / All Grades</option>` +
    Array.from({ length: totalGrades }, (_, i) => i + 1)
      .map((g) => `<option value="${g}">Grade ${g}</option>`)
      .join("");
  gSel.onchange = renderPrintContent;
  document.getElementById("printPreviewModal").classList.remove("hidden");
  renderPrintContent();
}

// Builds the header + all subject tables for ONE grade. Reused by both the
// single-grade view and the combined "All Grades" document.
function buildGradeSectionHtml(grade, { withHeader }) {
  const plans = (STATE._lastPlans || []).filter((p) => p.grade_level === grade);
  const deptById = Object.fromEntries(STATE.departments.map((d) => [d.id, d]));
  const subById = Object.fromEntries(STATE.subSubjects.map((s) => [s.id, s]));
  const dayLabel = Object.fromEntries(DAYS.map((d) => [d.code, d.ar + " / " + d.en]));

  let html = withHeader
    ? `<div class="grade-title" style="background:#1e293b;color:#fff;display:inline-block;padding:6px 14px;border-radius:6px;font-weight:bold;margin-bottom:10px;">
        <bdi dir="ltr">Grade ${grade}</bdi>
      </div>`
    : "";

  let hasAnyContent = false;

  STATE.departments.forEach((d) => {
    const deptPlans = plans.filter((p) => p.department_id === d.id);

    const groups = {};
    deptPlans.forEach((p) => {
      const key = p.sub_subject_id ?? "general";
      groups[key] = groups[key] || [];
      groups[key].push(p);
    });

    // If dept has sub_subjects — iterate them; otherwise render "general" group
    const deptSubs = STATE.subSubjects.filter((s) => s.department_id === d.id);
    const renderKeys = deptSubs.length > 0
      ? deptSubs.map((s) => String(s.id))
      : ["general"];

    renderKeys.forEach((key) => {
      const rows = groups[key] || [];
      const sub = key !== "general" ? subById[key] : null;

      // Determine days count: sub_subject.days_per_week → department.days_per_week → 5
      const daysCount = sub?.days_per_week ?? d.days_per_week ?? 5;
      const expectedDays = DAYS.slice(0, daysCount);

      // Skip entirely if sub_subject exists but has zero plans AND zero expected content
      // (still render to show empty rows so teacher sees what's missing)
      hasAnyContent = true;

      const byDay = {};
      rows.forEach((p) => { byDay[p.day_code] = p; });

      html += `<table class="print-subject-table w-full text-xs border mb-4">
        <thead>
          <tr style="background:${d.theme_color}; color:white;">
            <th class="p-2 text-start" colspan="5">${escapeHtml(d.department_name)}${sub ? " — " + escapeHtml(sub.name) : ""}</th>
          </tr>
          <tr class="bg-slate-100">
            <th class="p-2 text-start">Day</th>
            <th class="p-2 text-start">Classwork</th>
            <th class="p-2 text-start">Homework</th>
            <th class="p-2 text-start">Items Required</th>
            <th class="p-2 text-start">Tests & Quizzes</th>
          </tr>
        </thead>
        <tbody>
          ${expectedDays
            .map((day) => {
              const p = byDay[day.code];
              return `<tr class="border-t">
                <td class="p-2 font-medium whitespace-nowrap">${dayLabel[day.code] || day.code}</td>
                <td class="p-2">${p ? (escapeHtml(p.classwork) || "-") : "-"}</td>
                <td class="p-2">${p ? (escapeHtml(p.homework) || "-") : "-"}</td>
                <td class="p-2">${p ? (escapeHtml(p.items_required) || "-") : "-"}</td>
                <td class="p-2">${p ? (escapeHtml(p.tests_quizzes) || "-") : "-"}</td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>`;
    });
  });

  if (!hasAnyContent) {
    html += `<div class="text-slate-400 text-sm mb-4">لا توجد بيانات مُدخلة لهذا الصف بعد / No data entered for this grade yet.</div>`;
  }
  return html;
}

function _buildPrintHeader(nameAr, nameEn, logo, scopeLabel) {
  const dateRange = weekDateRange(STATE._lastWeek);
  const dateLineEn = dateRange ? ` &nbsp;|&nbsp; ${dateRange.fromEn} — ${dateRange.toEn}` : "";
  const dateLineAr = dateRange ? ` &nbsp;|&nbsp; ${dateRange.fromAr} — ${dateRange.toAr}` : "";
  return `
    <div class="flex items-center gap-4 border-b pb-4 mb-4">
      <img src="${logo}" class="w-16 h-16 object-cover rounded" onerror="this.style.display='none'"/>
      <div>
        <div class="font-bold text-lg">${escapeHtml(nameAr)} — ${escapeHtml(nameEn)}</div>
        <div class="text-sm text-slate-500">
          Weekly Plan — Term ${STATE._lastTerm} — Week ${STATE._lastWeek} — ${scopeLabel}${dateLineEn}
        </div>
        ${dateRange ? `<div class="text-xs text-slate-400" dir="rtl">الخطة الأسبوعية — الفصل ${STATE._lastTerm} — الأسبوع ${STATE._lastWeek}${dateLineAr}</div>` : ""}
      </div>
    </div>`;
}

function renderPrintContent() {
  const selected = document.getElementById("printGradeSelect").value;
  const totalGrades = parseInt(STATE.settings.total_grades || "10");
  const nameAr = STATE.settings.school_name_ar || "";
  const nameEn = STATE.settings.school_name_en || "";
  const logo = STATE.settings.school_logo_url || "";

  const scopeLabel = selected === "all" ? "All Grades" : `Grade ${selected}`;
  let html = _buildPrintHeader(nameAr, nameEn, logo, scopeLabel);

  if (selected === "all") {
    for (let g = 1; g <= totalGrades; g++) {
      const breakStyle = g < totalGrades ? "page-break-after:always;" : "";
      html += `<div class="grade-section" style="${breakStyle} page-break-inside:avoid;">`;
      html += buildGradeSectionHtml(g, { withHeader: true });
      html += `</div>`;
    }
  } else {
    html += buildGradeSectionHtml(parseInt(selected), { withHeader: false });
  }

  document.getElementById("printPreviewContent").innerHTML = html;
  document.getElementById("printArea").innerHTML = html;
}

/* ------------------------- PDF EXPORT QUEUE ------------------------- */
function openPdfExportQueue() {
  const totalGrades = parseInt(STATE.settings.total_grades || "10");

  // Build queue rows — one per grade
  let rows = "";
  for (let g = 1; g <= totalGrades; g++) {
    rows += `
      <div class="flex items-center justify-between border rounded-lg p-3" id="pdfRow-${g}">
        <span class="font-medium text-sm">Grade ${g}</span>
        <div class="flex items-center gap-2">
          <span id="pdfCheck-${g}" class="text-green-600 font-bold hidden">✓ تم</span>
          <button
            onclick="printGradeForPdf(${g})"
            id="pdfBtn-${g}"
            class="bg-slate-800 text-white rounded-lg px-3 py-1.5 text-sm min-h-[36px]">
            🖨 طباعة / PDF
          </button>
        </div>
      </div>`;
  }

  document.getElementById("pdfQueueList").innerHTML = rows;
  document.getElementById("pdfQueueModal").classList.remove("hidden");
}

function printGradeForPdf(grade) {
  const nameAr = STATE.settings.school_name_ar || "";
  const nameEn = STATE.settings.school_name_en || "";
  const logo   = STATE.settings.school_logo_url || "";

  const html =
    _buildPrintHeader(nameAr, nameEn, logo, `Grade ${grade}`) +
    buildGradeSectionHtml(grade, { withHeader: true });

  document.getElementById("printArea").innerHTML = html;
  window.print();

  document.getElementById(`pdfCheck-${grade}`)?.classList.remove("hidden");
  document.getElementById(`pdfBtn-${grade}`)?.classList.replace("bg-slate-800", "bg-green-700");
}
