/* Loads the question bank from questions-bd.json.
   NOTE: fetch() needs the page served over http(s) (e.g. VS Code "Live Server",
   `python -m http.server`, etc.) — opening index.html directly as a file:// URL
   will be blocked by the browser's CORS policy for local files. */

const QUESTIONS_DB_PATH = "questions-bd.json";

async function fetchQuestionsDB() {
  const response = await fetch(QUESTIONS_DB_PATH, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(
      `Não foi possível carregar ${QUESTIONS_DB_PATH} (status ${response.status})`,
    );
  }
  const data = await response.json();
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(
      "O banco de perguntas está vazio ou em um formato inválido.",
    );
  }
  return data;
}
