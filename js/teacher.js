function refreshSubSubjectOptions() {
  const dept = STATE.currentDept;
  const gradeVal = parseInt(document.getElementById("teacherGradeSelect").value);
  const subs = STATE.subSubjects.filter((s) => {
    if (s.department_id !== dept.id) return false;
    if (s.grade_from != null && gradeVal < s.grade_from) return false;
    if (s.grade_to != null && gradeVal > s.grade_to) return false;
    return true;
  });

  const subWrap = document.getElementById("teacherSubSubjectWrap");
  const subSelect = document.getElementById("teacherSubSelect");
  const prevValue = subSelect.value;

  if (subs.length > 0) {
    subWrap.classList.remove("hidden");
    subSelect.innerHTML = subs.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
    if (subs.some((s) => String(s.id) === prevValue)) subSelect.value = prevValue;
  } else {
    subWrap.classList.add("hidden");
    subSelect.innerHTML = "";
  }
}

function renderTeacherPortal() {
  const dept = STATE.currentDept;
  document.getElementById("teacherHeader").style.background = dept.theme_color;
  document.getElementById("teacherDeptName").innerText = dept.department_name;
  document.getElementById("teacherSchoolLine").innerText =
    (STATE.settings.school_name_en || "") + " — " + (STATE.settings.academic_year || "");
  document.getElementById("teacherSaveBtn").style.background = dept.theme_color;

  // Grades
  const totalGrades = parseInt(STATE.settings.total_grades || "10");
  const gradeSel = document.getElementById("teacherGradeSelect");
  gradeSel.innerHTML = Array.from({ length: totalGrades }, (_, i) => i + 1)
    .map((g) => `<option value="${g}">Grade ${g}</option>`)
    .join("");

  // Sub-subjects (grade-aware — see refreshSubSubjectOptions)
  refreshSubSubjectOptions();

  // Apply a smart weekly link's locked term/week, if the teacher arrived via ?token=
  const termSel = document.getElementById("teacherTermSelect");
  const weekInput = document.getElementById("teacherWeekInput");
  const lockedNote = document.getElementById("teacherLockedNote");
  if (STATE.lockedContext) {
    termSel.value = String(STATE.lockedContext.term);
    weekInput.value = STATE.lockedContext.week_number;
    termSel.disabled = true;
    weekInput.disabled = true;
    document.getElementById("lockedWeekText").innerText =
      `(Term ${STATE.lockedContext.term} — Week ${STATE.lockedContext.week_number})`;
    lockedNote.classList.remove("hidden");
  } else {
    termSel.disabled = false;
    weekInput.disabled = false;
    lockedNote.classList.add("hidden");
  }

  showView("view-teacher");
  ["teacherGradeSelect", "teacherSubSelect", "teacherTermSelect", "teacherWeekInput"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.dataset.prevValue = el.value;
  });
  loadTeacherPlan();
}

function currentTeacherContext() {
  const dept = STATE.currentDept;
  const grade = parseInt(document.getElementById("teacherGradeSelect").value);
  const term = parseInt(document.getElementById("teacherTermSelect").value);
  const week = parseInt(document.getElementById("teacherWeekInput").value);
  const subs = STATE.subSubjects.filter((s) => s.department_id === dept.id);
  const subSelect = document.getElementById("teacherSubSelect");
  const subId = subs.length > 0 ? parseInt(subSelect.value) : null;
  return { dept, grade, term, week, subId };
}

function toggleDayAccordion(headerEl) {
  headerEl.parentElement.classList.toggle("open");
}

function buildDayFields(existingByDay) {
  const dept = STATE.currentDept;
  const ctx = currentTeacherContext();
  const activeSub = STATE.subSubjects.find((s) => s.id === ctx.subId);
  const daysCount = activeSub?.days_per_week ?? dept.days_per_week;
  const days = DAYS.slice(0, daysCount);
  const container = document.getElementById("teacherDaysContainer");
  container.innerHTML = days
    .map((d, idx) => {
      const entry = existingByDay[d.code] || {};
      const hasContent = !!(
        (entry.classwork || "").trim() ||
        (entry.homework || "").trim() ||
        (entry.items_required || "").trim() ||
        (entry.tests_quizzes || "").trim()
      );
      const openClass = idx === 0 ? "open" : "";
      return `
      <div class="day-accordion card ${openClass}" style="border-top:4px solid ${dept.theme_color}">
        <div class="day-accordion-header flex items-center justify-between p-4" onclick="toggleDayAccordion(this)">
          <div class="font-bold flex items-center gap-2">
            ${d.ar} <span class="text-slate-400 text-sm">/ ${d.en}</span>
            ${hasContent ? '<span class="w-2 h-2 rounded-full bg-green-500" title="تم إدخال محتوى"></span>' : ""}
          </div>
          <span class="chevron text-slate-400 text-lg">▾</span>
        </div>
        <div class="day-accordion-body px-4 pb-4">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="text-xs text-slate-500">Classwork</label>
              <textarea data-day="${d.code}" data-field="classwork" class="w-full border rounded-lg p-2 text-sm" rows="2">${escapeHtml(entry.classwork)}</textarea>
            </div>
            <div>
              <label class="text-xs text-slate-500">Homework</label>
              <textarea data-day="${d.code}" data-field="homework" class="w-full border rounded-lg p-2 text-sm" rows="2">${escapeHtml(entry.homework)}</textarea>
            </div>
            <div>
              <label class="text-xs text-slate-500">Items Required</label>
              <textarea data-day="${d.code}" data-field="items_required" class="w-full border rounded-lg p-2 text-sm" rows="2">${escapeHtml(entry.items_required)}</textarea>
            </div>
            <div>
              <label class="text-xs text-slate-500">Tests & Quizzes</label>
              <textarea data-day="${d.code}" data-field="tests_quizzes" class="w-full border rounded-lg p-2 text-sm" rows="2">${escapeHtml(entry.tests_quizzes)}</textarea>
            </div>
          </div>
        </div>
      </div>`;
    })
    .join("");

  STATE.teacherDirty = false;
  container.querySelectorAll("textarea").forEach((el) => {
    el.addEventListener("input", () => { STATE.teacherDirty = true; });
  });
}

function guardedLoadTeacherPlan(el) {
  if (STATE.teacherDirty) {
    const proceed = confirm(
      "لديك تعديلات غير محفوظة، ستُفقد إذا تابعت.\nهل تريد المتابعة؟\n\n" +
      "You have unsaved changes that will be lost. Continue anyway?"
    );
    if (!proceed) {
      if (el && el.dataset.prevValue !== undefined) el.value = el.dataset.prevValue;
      return;
    }
  }
  if (el) el.dataset.prevValue = el.value;
  refreshSubSubjectOptions(); // in case the grade changed — some branches only apply to certain grades
  loadTeacherPlan();
}

async function loadTeacherPlan() {
  const ctx = currentTeacherContext();
  const year = STATE.settings.academic_year || "2026-2027";

  let q = sb
    .from("weekly_plans")
    .select("*")
    .eq("academic_year", year)
    .eq("term", ctx.term)
    .eq("week_number", ctx.week)
    .eq("department_id", ctx.dept.id)
    .eq("grade_level", ctx.grade);

  q = ctx.subId ? q.eq("sub_subject_id", ctx.subId) : q.is("sub_subject_id", null);

  const { data, error } = await q;
  if (error) console.error(error);

  const byDay = {};
  (data || []).forEach((row) => (byDay[row.day_code] = row));
  STATE._loadedMaxUpdatedAt = (data || []).reduce(
    (max, r) => (r.updated_at > max ? r.updated_at : max),
    ""
  );
  buildDayFields(byDay);
}

async function saveTeacherPlan() {
  const ctx = currentTeacherContext();
  const year = STATE.settings.academic_year || "2026-2027";
  const dept = ctx.dept;
  const activeSub = STATE.subSubjects.find((s) => s.id === ctx.subId);
  const daysCount = activeSub?.days_per_week ?? dept.days_per_week;
  const days = DAYS.slice(0, daysCount);

  // Conflict check: has this exact plan been changed elsewhere since we loaded it?
  let checkQ = sb
    .from("weekly_plans")
    .select("updated_at")
    .eq("academic_year", year)
    .eq("term", ctx.term)
    .eq("week_number", ctx.week)
    .eq("department_id", dept.id)
    .eq("grade_level", ctx.grade);
  checkQ = ctx.subId ? checkQ.eq("sub_subject_id", ctx.subId) : checkQ.is("sub_subject_id", null);
  const { data: freshRows } = await checkQ;
  const freshMax = (freshRows || []).reduce((max, r) => (r.updated_at > max ? r.updated_at : max), "");

  if (STATE._loadedMaxUpdatedAt && freshMax && freshMax > STATE._loadedMaxUpdatedAt) {
    const proceed = confirm(
      "تم تعديل هذه الخطة من جهاز آخر منذ فتحك لها.\nهل تريد المتابعة والكتابة فوق التعديلات الأخرى؟\n\n" +
      "This plan was changed elsewhere since you opened it. Overwrite anyway?"
    );
    if (!proceed) return;
  }

  const rows = days.map((d) => {
    const get = (field) =>
      document.querySelector(`[data-day="${d.code}"][data-field="${field}"]`)?.value || "";
    return {
      academic_year: year,
      term: ctx.term,
      week_number: ctx.week,
      department_id: dept.id,
      sub_subject_id: ctx.subId || null,
      grade_level: ctx.grade,
      day_code: d.code,
      classwork: get("classwork"),
      homework: get("homework"),
      items_required: get("items_required"),
      tests_quizzes: get("tests_quizzes"),
    };
  });

  const { error } = await sb
    .from("weekly_plans")
    .upsert(rows, {
      onConflict:
        "academic_year,term,week_number,department_id,sub_subject_id,grade_level,day_code",
    });

  const msg = document.getElementById("teacherSaveMsg");
  if (error) {
    console.error(error);
    alert("خطأ في الحفظ / Save error: " + error.message);
    return;
  }
  STATE.teacherDirty = false;
  msg.classList.remove("hidden");
  setTimeout(() => msg.classList.add("hidden"), 2000);
  loadTeacherPlan(); // refresh _loadedMaxUpdatedAt to the just-saved state
}

async function copyFromPreviousWeek() {
  const weekInput = document.getElementById("teacherWeekInput");
  const currentWeek = parseInt(weekInput.value);
  if (currentWeek <= 1) {
    alert("لا يوجد أسبوع سابق / No previous week");
    return;
  }
  const ctx = currentTeacherContext();
  const year = STATE.settings.academic_year || "2026-2027";

  let q = sb
    .from("weekly_plans")
    .select("*")
    .eq("academic_year", year)
    .eq("term", ctx.term)
    .eq("week_number", currentWeek - 1)
    .eq("department_id", ctx.dept.id)
    .eq("grade_level", ctx.grade);
  q = ctx.subId ? q.eq("sub_subject_id", ctx.subId) : q.is("sub_subject_id", null);

  const { data, error } = await q;
  if (error) { console.error(error); return; }
  if (!data || data.length === 0) {
    alert("لا توجد بيانات في الأسبوع السابق / No data found in previous week");
    return;
  }
  const byDay = {};
  data.forEach((row) => (byDay[row.day_code] = row));
  buildDayFields(byDay);
}

/* ------------------------- ADMIN DASHBOARD ------------------------- */
