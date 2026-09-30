async function init() {
  await loadSettings();
  await loadDepartments();
  await loadSubSubjects();
  applyBranding();

  const params = new URLSearchParams(window.location.search);
  const tokenParam = params.get("token");
  const deptParam = params.get("dept");

  if (tokenParam) {
    const ok = await tryLoadLinkToken(tokenParam);
    document.getElementById("loadingOverlay").classList.add("hidden");
    if (ok) return; // landing already rendered by tryLoadLinkToken
  } else {
    document.getElementById("loadingOverlay").classList.add("hidden");
  }

  if (deptParam) {
    const dept = STATE.departments.find(
      (d) => d.department_code.toLowerCase() === deptParam.toLowerCase()
    );
    if (dept) {
      populateDeptSelect(dept.id);
      showView("view-landing");
      return;
    }
  }
  populateDeptSelect();
  showView("view-landing");
}

/* Resolve a ?token=... smart weekly link created by the Admin */
async function tryLoadLinkToken(token) {
  const { data, error } = await sb
    .from("access_links")
    .select("*")
    .eq("token", token)
    .eq("is_active", true)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error || !data) {
    alert("هذا الرابط غير صالح أو انتهت صلاحيته / This link is invalid or has expired.");
    return false;
  }

  const dept = STATE.departments.find((d) => d.id === data.department_id);
  if (!dept) return false;

  STATE.lockedContext = { term: data.term, week_number: data.week_number, academic_year: data.academic_year };
  populateDeptSelect(dept.id);
  document.getElementById("deptSelect").disabled = true;
  showView("view-landing");
  return true;
}

async function loadSettings() {
  const { data, error } = await sb.from("school_settings").select("*");
  if (error) { console.error(error); debugLog("loadSettings error: " + JSON.stringify(error.message || error)); return; }
  STATE.settings = {};
  data.forEach((row) => (STATE.settings[row.setting_key] = row.setting_value));
}

async function loadDepartments() {
  const { data, error } = await sb
    .from("departments")
    .select("id,department_code,department_name,theme_color,days_per_week,sort_order,head_name,specialization,whatsapp_number")
    .order("sort_order");
  if (error) { console.error(error); debugLog("loadDepartments error: " + JSON.stringify(error.message || error)); return; }
  STATE.departments = data || [];
}

async function loadSubSubjects() {
  const { data, error } = await sb.from("sub_subjects").select("*");
  if (error) { console.error(error); return; }
  STATE.subSubjects = data || [];
}

function applyBranding() {
  const nameAr = STATE.settings.school_name_ar || "اسم المدرسة";
  const nameEn = STATE.settings.school_name_en || "School Name";
  const logo = STATE.settings.school_logo_url || "https://placehold.co/120x120?text=Logo";

  document.getElementById("landingLogo").src = logo;
  document.getElementById("landingSchoolName").innerText = `${nameAr} — ${nameEn}`;
  document.title = `${nameEn} | Weekly Plan`;

  document.getElementById("adminLogo").src = logo;
  document.getElementById("adminSchoolName").innerText = `${nameAr} — ${nameEn}`;
}

function showView(id) {
  ["view-landing", "view-teacher", "view-admin"].forEach((v) =>
    document.getElementById(v).classList.add("hidden")
  );
  document.getElementById(id).classList.remove("hidden");
}

function closeModal(id) { document.getElementById(id).classList.add("hidden"); }

// Tapping the dark backdrop (but NOT the modal card itself) closes it —
// the standard mobile-friendly dismissal pattern. Since this listener sits
// on the backdrop element, a click only reaches here when it didn't land
// on any child element first (the card and everything inside it stop here
// naturally because target === currentTarget only when clicking the
// backdrop directly).
function closeModalOnBackdrop(event, id) {
  if (event.target === event.currentTarget) closeModal(id);
}

const ALL_MODAL_IDS = ["adminPinModal", "settingsModal", "manageModal", "sendQueueModal", "printPreviewModal"];

// Escape key closes whichever modal is currently open — standard desktop
// convenience. Harmless on mobile (no physical Escape key, so it simply
// never fires there); the backdrop-tap above covers mobile instead.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  ALL_MODAL_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (el && !el.classList.contains("hidden")) closeModal(id);
  });
});

function guardedLogout() {
  if (STATE.teacherDirty) {
    const proceed = confirm(
      "لديك تعديلات غير محفوظة، ستُفقد إذا خرجت.\nهل تريد المتابعة؟\n\n" +
      "You have unsaved changes that will be lost. Log out anyway?"
    );
    if (!proceed) return;
  }
  logout();
}

function logout() {
  STATE.currentDept = null;
  STATE.isAdmin = false;
  STATE.lockedContext = null;
  STATE._adminPin = null;
  STATE.teacherDirty = false;
  document.getElementById("deptSelect").disabled = false;
  window.history.replaceState({}, "", window.location.pathname);
  showView("view-landing");
}

/* ------------------------- LANDING / LOGIN ------------------------- */
function populateDeptSelect(preselectId) {
  const sel = document.getElementById("deptSelect");
  sel.innerHTML = STATE.departments
    .map((d) => `<option value="${d.id}">${d.department_name}</option>`)
    .join("");
  if (preselectId) sel.value = preselectId;
}

async function handleTeacherLogin() {
  const btn = document.getElementById("teacherLoginBtn");
  await runWithLoading(btn, "جاري التحقق... / Checking...", async () => {
  const deptId = parseInt(document.getElementById("deptSelect").value);
  const pin = document.getElementById("deptPinInput").value.trim();
  const dept = STATE.departments.find((d) => d.id === deptId);
  const errEl = document.getElementById("deptPinError");
  if (!dept) return;

  const { data, error } = await sb.rpc("verify_department_pin", {
    p_department_id: deptId,
    p_pin: pin,
  });
  debugLog(`verify_department_pin(dept=${deptId}) -> data=${JSON.stringify(data)} error=${error ? JSON.stringify(error.message || error) : "null"}`);

  if (error) {
    errEl.innerText = "تعذر التحقق الآن، حاول مجدداً / Could not verify right now";
    errEl.classList.remove("hidden");
    console.error(error);
    return;
  }
  if (data === "locked") {
    errEl.innerText = "محاولات كثيرة جداً، حاول بعد دقيقتين / Too many attempts — wait a bit";
    errEl.classList.remove("hidden");
    return;
  }
  if (data !== "ok") {
    errEl.innerText = "رمز غير صحيح / Wrong PIN";
    errEl.classList.remove("hidden");
    return;
  }

  errEl.classList.add("hidden");
  STATE.currentDept = dept;
  document.getElementById("deptPinInput").value = "";
  renderTeacherPortal();
  });
}

function openAdminPinPrompt() {
  document.getElementById("adminPinInput").value = "";
  document.getElementById("adminPinError").classList.add("hidden");
  document.getElementById("adminPinModal").classList.remove("hidden");
}

async function handleAdminLogin() {
  const btn = document.getElementById("adminLoginBtn");
  await runWithLoading(btn, "جاري التحقق... / Checking...", async () => {
  const pin = document.getElementById("adminPinInput").value.trim();
  const errEl = document.getElementById("adminPinError");

  const { data, error } = await sb.rpc("verify_admin_pin", { p_pin: pin });
  debugLog(`verify_admin_pin() -> data=${JSON.stringify(data)} error=${error ? JSON.stringify(error.message || error) : "null"}`);

  if (error) {
    errEl.innerText = "تعذر التحقق الآن / Could not verify right now";
    errEl.classList.remove("hidden");
    console.error(error);
    return;
  }
  if (data === "locked") {
    errEl.innerText = "محاولات كثيرة جداً، حاول بعد دقيقتين / Too many attempts — wait a bit";
    errEl.classList.remove("hidden");
    return;
  }
  if (data !== "ok") {
    errEl.innerText = "رمز غير صحيح / Wrong PIN";
    errEl.classList.remove("hidden");
    return;
  }

  closeModal("adminPinModal");
  STATE.isAdmin = true;
  STATE._adminPin = pin; // kept in memory only, for this session's admin-only actions
  renderAdminDashboard();
  });
}

/* ------------------------- TEACHER PORTAL ------------------------- */
// Rebuilds the sub-subject dropdown for the CURRENTLY selected grade.
// A branch with no grade_from/grade_to applies to all grades. Called on
// portal open and again every time the grade selection changes.
