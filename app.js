/* ============================================================
   CONFIG
   ============================================================ */
const EXAM_LENGTH = 40;
const EXAM_DURATION_SECONDS = 60 * 60; // 60 min, matches the real 1Z0-1122-26 exam
const PASS_THRESHOLD = 0.65; // 65%, below this the exam is failed
const IMPROVE_THRESHOLD = 0.75; // 75%, below this a passing score is still flagged as "room to improve"
const OFFICIAL_EXAM_THRESHOLD = 0.8; // 80%, at or above this the student is "ready" and the official OCI myLearn exam link is shown

// Shared across every screen's <header class="exam-header"> — kept in one
// place instead of duplicated in each screen's markup.
const HEADER_LOGO_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 130 36" width="130" height="36">
    <rect width="130" height="36" rx="4" fill="#0C1622"/>
    <rect x="12" y="4"  width="14" height="6"  rx="1.5" fill="#E5801A"/>
    <rect x="8"  y="12" width="16" height="6"  rx="1.5" fill="#3AA8A8"/>
    <rect x="4"  y="20" width="17" height="6"  rx="1.5" fill="#7BA87B"/>
    <text x="28" y="19" font-family="Arial,Helvetica,sans-serif" font-weight="bold" font-size="15" fill="#FFFFFF">ONE</text>
    <text x="28" y="30" font-family="Arial,Helvetica,sans-serif" font-size="7"  fill="#B0BEC5">Oracle Next Education</text>
  </svg>
`;
const HEADER_TITLE_HTML =
  "Simulator Exam - Oracle Cloud Infrastructure (1Z0-1122-26) <strong>OCI AI Foundations Associate</strong>";

/* ============================================================
   STATE
   All mutable exam state lives on a single object instead of loose
   module-level `let` bindings, so it's clear at a glance what the
   app's state shape is and functions can't accidentally shadow it.
   ============================================================ */
const state = {
  questionBank: [],
  examQuestions: [], // [{ q, explanation, options: [{text, isCorrect}] }]
  answers: [], // [{ selected: number|null, marked: boolean }]
  currentIndex: 0,
  timeRemaining: EXAM_DURATION_SECONDS,
  timerInterval: null,
  mode: "exam", // 'exam' | 'review'
  visitorId: null,
  attemptNumber: 0,
  examFinished: false,
};

/* ============================================================
   DOM HELPERS
   ============================================================ */
const byId = (id) => document.getElementById(id);
const setHidden = (el, hidden) => el.classList.toggle("hidden", hidden);

function showScreen(id) {
  document
    .querySelectorAll(".screen")
    .forEach((s) => s.classList.remove("active"));
  byId(id).classList.add("active");
}

function renderSharedHeaders() {
  document.querySelectorAll(".header-logo").forEach((el) => {
    el.innerHTML = HEADER_LOGO_SVG;
  });
  document.querySelectorAll(".header-title").forEach((el) => {
    el.innerHTML = HEADER_TITLE_HTML;
  });
}

/* ============================================================
   HELPERS
   ============================================================ */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function formatTime(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

function formatDurationLabel(totalSeconds) {
  return `${Math.round(totalSeconds / 60)} min`;
}

// Escapes text before it's interpolated into an innerHTML template, so
// question/option text can never be misread as markup.
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
function getVisitorId() {
  try {
    let visitorId = localStorage.getItem("visitor_id");

    if (!visitorId) {
      visitorId = crypto.randomUUID();
      localStorage.setItem("visitor_id", visitorId);
    }

    return visitorId;
  } catch (error) {
    console.warn("No se pudo obtener el ID del visitante:", error);
    return null;
  }
}

function getAttemptNumber() {
  try {
    const attempts = Number(localStorage.getItem("exam_attempts")) || 0;
    const nextAttempt = attempts + 1;

    localStorage.setItem("exam_attempts", String(nextAttempt));

    return nextAttempt;
  } catch (error) {
    console.warn("No se pudo guardar el número de intento:", error);
    return null;
  }
}

function getAnsweredQuestionsCount() {
  return state.answers.filter((answer) => answer.selected !== null).length;
}

function sendAnalyticsEvent(eventName, parameters = {}) {
  if (typeof gtag !== "function") {
    console.warn(`Analytics no está disponible. Evento omitido: ${eventName}`);
    return;
  }

  gtag("event", eventName, parameters);
}
/* ============================================================
   QUESTION / ANSWER HELPERS (shared by the quiz review panel and
   the incorrect-questions screen)
   ============================================================ */
function optionRowClass(opt, optIdx, selectedIdx) {
  if (opt.isCorrect) return "opt-correct";
  if (selectedIdx === optIdx) return "opt-wrong";
  return null;
}

function answerStatusLine(item, answer) {
  if (answer.selected === null) return "No respondiste esta pregunta.";
  if (item.options[answer.selected].isCorrect) return "¡Correcto!";
  return `Tu respuesta: ${escapeHtml(item.options[answer.selected].text)}`;
}

function explanationHTML(item, answer) {
  const correctOpt = item.options.find((o) => o.isCorrect);
  return `
    <strong>${answerStatusLine(item, answer)}</strong>
    <p>Respuesta correcta: ${escapeHtml(correctOpt.text)}</p>
    <p>${escapeHtml(item.explanation)}</p>
  `;
}

function createGridCell(number, statusText, extraClass, onClick) {
  const cell = document.createElement("div");
  cell.className = `sg-item ${extraClass}`;
  cell.innerHTML = `<span class="sg-num">${number}</span><span class="sg-status">${statusText}</span>`;
  cell.addEventListener("click", onClick);
  return cell;
}

/* ============================================================
   EXAM SETUP
   ============================================================ */
function buildExamQuestions(bank, count) {
  const picked = shuffle(bank).slice(0, Math.min(count, bank.length));
  return picked.map((item) => {
    const optionObjs = item.options.map((text, idx) => ({
      text,
      isCorrect: idx === item.correct,
    }));
    return {
      q: item.q,
      explanation: item.explanation,
      options: shuffle(optionObjs),
    };
  });
}

function startExam() {
  state.visitorId = getVisitorId();
  state.attemptNumber = getAttemptNumber();

  state.examQuestions = buildExamQuestions(state.questionBank, EXAM_LENGTH);
  state.answers = state.examQuestions.map(() => ({
    selected: null,
    marked: false,
  }));

  state.currentIndex = 0;
  state.timeRemaining = EXAM_DURATION_SECONDS;
  state.mode = "exam";
  state.examFinished = false;

  setHidden(document.querySelector(".timer-strip"), false);
  byId("btn-summary").textContent = "Summary";
  byId("hn-tot").textContent = state.examQuestions.length;

  sendAnalyticsEvent("iniciar_simulador", {
    examen: "1Z0-1122-26",
    visitor_id: state.visitorId,
    numero_intento: state.attemptNumber,
    total_preguntas: state.examQuestions.length,
  });

  showScreen("quiz-screen");
  renderQuestion();
  startTimer();
}

/* ============================================================
   QUESTION RENDERING
   ============================================================ */
function renderQuestion() {
  const total = state.examQuestions.length;
  const item = state.examQuestions[state.currentIndex];
  const answer = state.answers[state.currentIndex];

  byId("hn-cur").textContent = state.currentIndex + 1;
  byId("hn-tot").textContent = total;
  byId("page-lbl").textContent = `${state.currentIndex + 1} of ${total} Pages`;
  byId("q-text").textContent = item.q;

  const markCb = byId("mark-cb");
  const markLabel = markCb.closest(".mark-label");
  setHidden(markLabel, state.mode === "review");
  if (state.mode !== "review") markCb.checked = answer.marked;

  const list = byId("options-list");
  list.innerHTML = "";
  item.options.forEach((opt, idx) => {
    // The whole row IS the <label>, so clicking anywhere in it (padding,
    // text, or the radio dot) natively toggles the input. That means a
    // single 'change' listener on the input is enough to catch every way
    // of selecting an option — no separate row 'click' handler needed,
    // which previously fired alongside 'change' and double-triggered
    // selectOption()/renderQuestion() per click.
    const row = document.createElement("label");
    row.className = "opt-row";

    const input = document.createElement("input");
    input.type = "radio";
    input.name = "option";
    input.value = String(idx);
    input.disabled = state.mode === "review";
    input.checked = answer.selected === idx;

    const text = document.createElement("span");
    text.className = "opt-text";
    text.textContent = opt.text;

    if (state.mode === "review") {
      const rowStateClass = optionRowClass(opt, idx, answer.selected);
      if (rowStateClass) row.classList.add(rowStateClass);
    } else {
      input.addEventListener("change", () => selectOption(idx));
    }

    row.append(input, text);
    list.appendChild(row);
  });

  const expPanel = byId("exp-panel");
  if (state.mode === "review") {
    const isCorrect =
      answer.selected !== null && item.options[answer.selected].isCorrect;
    expPanel.classList.remove("exp-correct", "exp-wrong");
    expPanel.classList.add(isCorrect ? "exp-correct" : "exp-wrong");
    expPanel.innerHTML = explanationHTML(item, answer);
  } else {
    expPanel.innerHTML = "";
  }
  setHidden(expPanel, state.mode !== "review");

  byId("btn-prev").disabled = state.currentIndex === 0;
  byId("hn-prev").disabled = state.currentIndex === 0;
  const atEnd = state.currentIndex === total - 1;
  byId("hn-next").disabled = atEnd;

  const btnNext = byId("btn-next");
  btnNext.disabled = false;
  btnNext.textContent = atEnd
    ? state.mode === "review"
      ? "Back to Results"
      : "Finish"
    : "Next";
}

function selectOption(idx) {
  if (state.mode !== "exam") return;
  state.answers[state.currentIndex].selected = idx;
  renderQuestion();
}

function goPrev() {
  if (state.currentIndex > 0) {
    state.currentIndex--;
    renderQuestion();
  }
}

function goNext() {
  if (state.currentIndex < state.examQuestions.length - 1) {
    state.currentIndex++;
    renderQuestion();
  }
}

/* ============================================================
   TIMER
   ============================================================ */
function updateTimerDisplay() {
  const text = formatTime(state.timeRemaining);
  const t1 = byId("timer");
  const t2 = byId("timer-s");
  if (t1) t1.textContent = text;
  if (t2) t2.textContent = text;
}

function startTimer() {
  clearInterval(state.timerInterval);
  updateTimerDisplay();
  state.timerInterval = setInterval(() => {
    state.timeRemaining--;
    if (state.timeRemaining <= 0) {
      state.timeRemaining = 0;
      updateTimerDisplay();
      clearInterval(state.timerInterval);
      alert("Se acabó el tiempo. El examen se enviará automáticamente.");
      finishExam();
      return;
    }
    updateTimerDisplay();
  }, 1000);
}

/* ============================================================
   SUMMARY SCREEN
   ============================================================ */
function showSummary() {
  const unansweredIdx = state.answers
    .map((a, idx) => (a.selected === null ? idx : null))
    .filter((idx) => idx !== null);

  const msg = byId("summary-msg");
  const btnSubmit = byId("btn-submit");
  const grid = byId("summary-grid");
  msg.classList.remove("msg-ok", "msg-warn");
  grid.innerHTML = "";

  if (unansweredIdx.length > 0) {
    const label = unansweredIdx.length === 1 ? "pregunta" : "preguntas";
    const numbers = unansweredIdx.map((idx) => idx + 1);
    msg.textContent = `Falta responder ${unansweredIdx.length} ${label}: ${numbers.join(", ")}. Debes responderlas todas antes de enviar el examen.`;
    msg.classList.add("msg-warn");
    btnSubmit.disabled = true;
    setHidden(grid, false);

    unansweredIdx.forEach((idx) => {
      const marked = state.answers[idx].marked;
      const cell = createGridCell(
        idx + 1,
        marked ? "Marked" : "Not answered",
        marked ? "sg-marked" : "sg-unanswered",
        () => {
          state.currentIndex = idx;
          showScreen("quiz-screen");
          renderQuestion();
        },
      );
      grid.appendChild(cell);
    });
  } else {
    msg.textContent =
      "Has respondido todas las preguntas. Puedes enviar el examen cuando quieras.";
    msg.classList.add("msg-ok");
    btnSubmit.disabled = false;
    setHidden(grid, true);
  }

  showScreen("summary-screen");
}

/* ============================================================
   RESULTS
   ============================================================ */
function finishExam() {
  state.examFinished = true;
  clearInterval(state.timerInterval);
  const total = state.examQuestions.length;
  let correct = 0;
  state.examQuestions.forEach((item, idx) => {
    const sel = state.answers[idx].selected;
    if (sel !== null && item.options[sel].isCorrect) correct++;
  });
  const incorrect = total - correct;
  const ratio = correct / total;
  const pct = Math.round(ratio * 100);

  const secondsUsed = EXAM_DURATION_SECONDS - state.timeRemaining;

  sendAnalyticsEvent("resultado_simulado", {
    examen: "1Z0-1122-26",
    visitor_id: state.visitorId,
    numero_intento: state.attemptNumber,
    status: ratio >= PASS_THRESHOLD ? "aprobado" : "reprobado",
    puntaje: pct,
    correctas: correct,
    incorrectas: incorrect,
    total_preguntas: total,
    tiempo_segundos: secondsUsed,
  });

  byId("res-total").textContent = total;
  byId("res-correct").textContent = correct;
  byId("res-incorrect").textContent = incorrect;
  byId("res-pct").textContent = `${pct}%`;

  const badge = byId("result-badge");
  badge.classList.remove("not-approved", "improve", "ready");
  if (ratio < PASS_THRESHOLD) {
    badge.textContent =
      "No aprobaste. Continúa practicando, revisa las respuestas incorrectas y continúa estudiando.";
    badge.classList.add("not-approved");
  } else if (ratio < IMPROVE_THRESHOLD) {
    badge.textContent =
      "¡Felicidades! Aprobaste el simulado, pero puedes mejorar tu puntaje. Revisa las respuestas incorrectas — vale la pena el esfuerzo.";
    badge.classList.add("improve");
  } else if (ratio < OFFICIAL_EXAM_THRESHOLD) {
    badge.textContent =
      "¡Felicidades! Aprobaste el simulado. Con un poco más de práctica puedes alcanzar el 80%.";
    badge.classList.add("ready");
  } else {
    badge.textContent =
      "¡Felicidades! Estás listo para la prueba real en Oracle myLearn.";
    badge.classList.add("ready");
  }

  setHidden(byId("official-exam-link"), ratio < OFFICIAL_EXAM_THRESHOLD);
  // "Review Incorrect Questions" is only meaningful when there's at least
  // one wrong answer to show — not tied to pass/fail, since a passing
  // score can still have incorrect answers worth reviewing.
  setHidden(byId("btn-incorrect"), incorrect === 0);

  showScreen("results-screen");
}

function startReview() {
  sendAnalyticsEvent("revisar_respuestas", {
    examen: "1Z0-1122-26",
    visitor_id: state.visitorId,
    numero_intento: state.attemptNumber,
  });

  state.mode = "review";
  state.currentIndex = 0;
  setHidden(document.querySelector(".timer-strip"), true);
  byId("btn-summary").textContent = "Back to Results";
  showScreen("quiz-screen");
  renderQuestion();
}

/* ============================================================
   INCORRECT QUESTIONS SCREEN
   ============================================================ */
function getIncorrectIndexes() {
  return state.examQuestions
    .map((item, idx) => {
      const sel = state.answers[idx].selected;
      const isCorrect = sel !== null && item.options[sel].isCorrect;
      return isCorrect ? null : idx;
    })
    .filter((idx) => idx !== null);
}

function showIncorrectScreen() {
  const incorrectIdx = getIncorrectIndexes();
  const label =
    incorrectIdx.length === 1 ? "pregunta incorrecta" : "preguntas incorrectas";
  byId("incorrect-msg").textContent =
    `Tienes ${incorrectIdx.length} ${label}. Haz clic en un número para ver la explicación.`;

  const grid = byId("incorrect-grid");
  grid.innerHTML = "";
  setHidden(grid, false);
  setHidden(byId("incorrect-detail"), true);

  incorrectIdx.forEach((idx) => {
    grid.appendChild(
      createGridCell(idx + 1, "Incorrect", "sg-incorrect", () =>
        renderIncorrectDetail(idx),
      ),
    );
  });

  showScreen("incorrect-screen");
}

function renderIncorrectDetail(idx) {
  const item = state.examQuestions[idx];
  const answer = state.answers[idx];

  setHidden(byId("incorrect-grid"), true);
  setHidden(byId("incorrect-detail"), false);
  byId("incorrect-detail-question").textContent = `${idx + 1}. ${item.q}`;

  const optionsList = byId("incorrect-detail-options");
  optionsList.innerHTML = "";
  item.options.forEach((opt, oIdx) => {
    const row = document.createElement("div");
    row.className = "opt-row";
    const rowStateClass = optionRowClass(opt, oIdx, answer.selected);
    if (rowStateClass) row.classList.add(rowStateClass);

    const text = document.createElement("span");
    text.className = "opt-text";
    text.textContent = opt.text;
    row.appendChild(text);
    optionsList.appendChild(row);
  });

  byId("incorrect-detail-exp").innerHTML = explanationHTML(item, answer);
}

/* ============================================================
   INIT
   ============================================================ */
async function initApp() {
  renderSharedHeaders();

  const passPct = `${Math.round(PASS_THRESHOLD * 100)}%`;
  byId("start-pass-pct").textContent = passPct;
  byId("res-pass-pct").textContent = passPct;

  try {
    state.questionBank = await fetchQuestionsDB();
  } catch (err) {
    byId("start-q-count").textContent = "—";
    alert(
      `Error cargando el banco de preguntas: ${err.message}\n` +
        "Asegúrate de servir este proyecto con un servidor local " +
        '(por ejemplo, la extensión "Live Server" de VS Code o "python -m http.server") ' +
        "en lugar de abrir index.html directamente como archivo.",
    );
    return;
  }

  byId("start-q-count").textContent = Math.min(
    EXAM_LENGTH,
    state.questionBank.length,
  );
  byId("start-duration").textContent = formatDurationLabel(
    EXAM_DURATION_SECONDS,
  );

  bindEvents();
}

function bindEvents() {
  byId("start-btn").addEventListener("click", startExam);

  byId("hn-prev").addEventListener("click", goPrev);
  byId("hn-next").addEventListener("click", goNext);
  byId("btn-prev").addEventListener("click", goPrev);
  byId("btn-next").addEventListener("click", () => {
    const atEnd = state.currentIndex === state.examQuestions.length - 1;
    if (!atEnd) {
      goNext();
    } else if (state.mode === "review") {
      showScreen("results-screen");
    } else {
      showSummary();
    }
  });

  byId("mark-cb").addEventListener("change", (e) => {
    if (state.mode !== "exam") return;
    state.answers[state.currentIndex].marked = e.target.checked;
  });

  byId("btn-summary").addEventListener("click", () => {
    if (state.mode === "review") {
      showScreen("results-screen");
    } else {
      showSummary();
    }
  });

  byId("btn-back").addEventListener("click", () => {
    const firstUnansweredIdx = state.answers.findIndex(
      (a) => a.selected === null,
    );
    if (firstUnansweredIdx !== -1) state.currentIndex = firstUnansweredIdx;
    showScreen("quiz-screen");
    renderQuestion();
  });
  byId("btn-submit").addEventListener("click", finishExam);

  byId("btn-review").addEventListener("click", startReview);
  byId("btn-retake").addEventListener("click", startExam);

  byId("btn-incorrect").addEventListener("click", showIncorrectScreen);
  byId("btn-incorrect-detail-back").addEventListener("click", () => {
    setHidden(byId("incorrect-detail"), true);
    setHidden(byId("incorrect-grid"), false);
  });
  byId("btn-incorrect-close").addEventListener("click", () =>
    showScreen("results-screen"),
  );
  byId("official-exam-link").addEventListener("click", () => {
    sendAnalyticsEvent("abrir_examen_oficial", {
      examen: "1Z0-1122-26",
      visitor_id: state.visitorId,
      numero_intento: state.attemptNumber,
    });
  });
}
window.addEventListener("beforeunload", () => {
  if (state.mode !== "exam") return;
  if (state.examFinished) return;

  const preguntasRespondidas = getAnsweredQuestionsCount();

  sendAnalyticsEvent("abandonar_simulador", {
    examen: "1Z0-1122-26",
    visitor_id: state.visitorId,
    numero_intento: state.attemptNumber,
    pregunta_actual: state.currentIndex + 1,
    tiempo_restante: state.timeRemaining,
    preguntas_respondidas: preguntasRespondidas,
  });
});
document.addEventListener("DOMContentLoaded", initApp);
