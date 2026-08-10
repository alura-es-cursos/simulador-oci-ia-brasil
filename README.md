# Simulador de Examen — OCI AI Foundations Associate (1Z0-1122-26)

Simulador web del examen de certificación **Oracle Cloud Infrastructure AI Foundations Associate (1Z0-1122-26)**. Presenta un examen de opción múltiple con temporizador, pantalla de resumen, calificación automática, revisión de respuestas y revisión específica de preguntas falladas — replicando la experiencia de la plataforma oficial de Oracle myLearn/Pearson VUE.

Es una aplicación 100% front-end: sin build step, sin frameworks y sin backend. El banco de preguntas se carga desde un archivo JSON local vía `fetch`.

## Tabla de contenidos

- [Estructura del proyecto](#estructura-del-proyecto)
- [Tecnologías](#tecnologías)
- [Cómo ejecutar el proyecto](#cómo-ejecutar-el-proyecto)
- [Flujo de la aplicación](#flujo-de-la-aplicación)
- [Formato del banco de preguntas](#formato-del-banco-de-preguntas)
- [Reglas de negocio](#reglas-de-negocio)
- [Configuración](#configuración)

## Estructura del proyecto

```
├── index.html          # Marcado de las 5 pantallas de la app (start, quiz, summary, results, incorrect)
├── app.js              # Lógica de la aplicación: estado, navegación, temporizador, calificación
├── questions.js         # Carga y valida el banco de preguntas (fetch a questions-bd.json)
├── questions-bd.json    # Banco de preguntas (banco de datos estático)
├── styles.css           # Estilos de toda la aplicación
└── README.md
```

## Tecnologías

- HTML5 / CSS3 / JavaScript (vanilla, ES2017+, sin dependencias ni transpilación)
- `fetch` + `async/await` para cargar el banco de preguntas
- Sin frameworks, sin bundler, sin `package.json`

## Cómo ejecutar el proyecto

La app usa `fetch()` para leer `questions-bd.json`, por lo que **debe** servirse por HTTP — abrir `index.html` directamente como archivo (`file://`) falla por la política CORS del navegador para archivos locales.

Cualquiera de estas opciones funciona:

```bash
# Python
python -m http.server 8080

# Node
npx http-server -p 8080
```

O usar la extensión **Live Server** de VS Code. Luego abrir `http://localhost:8080/index.html`.

## Flujo de la aplicación

1. **Start Screen** — muestra cantidad de preguntas, duración y puntaje mínimo para aprobar; botón "Start Exam".
2. **Quiz Screen** — una pregunta por vez, navegación libre (anterior/siguiente), checkbox "Mark for Review", temporizador visible, botón "Summary".
3. **Summary Screen** — lista las preguntas sin responder (marcadas o no) antes de permitir el envío del examen.
4. **Results Screen** — puntaje final, total de correctas/incorrectas, badge de aprobado/no aprobado, y accesos a "Take Exam Again", "Review Answers" y (si aplica) "Review Incorrect Questions" / enlace al examen oficial.
5. **Incorrect Questions Screen** — grilla con únicamente las preguntas falladas; al hacer clic en una se ve el detalle con la explicación y la opción correcta resaltada.

## Formato del banco de preguntas

`questions-bd.json` es un array de objetos con esta forma:

```json
{
  "q": "Texto de la pregunta",
  "options": ["Opción A", "Opción B", "Opción C", "Opción D"],
  "correct": 1,
  "explanation": "Por qué la opción correcta es la correcta."
}
```

- `options`: lista de textos de respuesta (mínimo 2).
- `correct`: índice (base 0) dentro de `options` que indica la respuesta correcta. Solo puede haber **una** respuesta correcta por pregunta.
- `explanation`: texto que explica por qué la respuesta correcta lo es. Se muestra en el panel de revisión tanto si el alumno acertó como si falló la pregunta.

## Reglas de negocio

Reglas identificadas a partir de la lógica implementada en `app.js` / `questions.js`:

### Composición y aleatoriedad del examen
- El examen se compone de **40 preguntas** (`EXAM_LENGTH`), seleccionadas al azar y sin repetición desde el banco de preguntas completo. Si el banco tiene menos de 40 preguntas disponibles, el examen usa todas las que existan.
- El **orden de las preguntas** y el **orden de las opciones de respuesta** dentro de cada pregunta se aleatorizan en cada intento (`shuffle`), por lo que dos ejecuciones del examen no presentan la misma secuencia.
- Cada pregunta tiene **exactamente una respuesta correcta** (selección única, tipo radio button).
- El banco de preguntas debe cargar correctamente y no puede estar vacío; si falla la carga o el JSON tiene un formato inválido, el examen no puede iniciarse.

### Duración y temporizador
- El examen tiene una duración máxima de **60 minutos** (`EXAM_DURATION_SECONDS`), igual que el examen oficial 1Z0-1122-26.
- El temporizador corre de forma continua durante el examen y se detiene/oculta en modo revisión.
- Si el tiempo llega a **00:00:00**, el examen se **envía automáticamente** con las respuestas que se hayan marcado hasta ese momento (las preguntas sin responder cuentan como incorrectas).

### Navegación y respuesta
- El usuario puede navegar libremente hacia adelante y atrás entre preguntas sin perder las respuestas ya seleccionadas.
- Una pregunta puede marcarse como **"Mark for Review"** para identificarla visualmente en la pantalla de resumen; esta marca es solo informativa y no afecta la calificación.
- **No se puede enviar el examen si quedan preguntas sin responder.** La pantalla de resumen lista cada pregunta pendiente (indicando si está marcada o no) y bloquea el botón "Submit Exam" hasta que todas tengan una respuesta seleccionada.
- Una vez enviado el examen (por envío manual o por fin del tiempo), las respuestas quedan fijas y el examen pasa a modo solo lectura.

### Calificación y resultado
- El puntaje se calcula como `respuestas correctas / total de preguntas`.
- El resultado se comunica en **4 niveles**, según en qué rango cae el puntaje:

  | Rango de puntaje         | Color  | Mensaje                                                                                          |
  |---------------------------|--------|---------------------------------------------------------------------------------------------------|
  | Menor a 65%                | Rojo   | "No aprobaste. Continúa practicando y revisa las respuestas incorrectas."                          |
  | Entre 65% y 75% (exclusive)| Azul   | "¡Felicidades! Aprobaste el simulado, pero puedes mejorar tu puntaje. Revisa las respuestas incorrectas — vale la pena el esfuerzo." |
  | Entre 75% y 80% (exclusive)| Verde  | "¡Felicidades! Con un poco más de práctica puedes alcanzar el 80%."                                |
  | 80% o más                  | Verde  | "¡Felicidades! Estás listo para la prueba real." — además se muestra el enlace "Realizar prueba en Oracle myLearn". |

- **Umbral de aprobación: 65%** (`PASS_THRESHOLD`) — por debajo de este puntaje el examen se considera no aprobado.
- **Umbral de "puedes mejorar": 75%** (`IMPROVE_THRESHOLD`) — separa el nivel azul del nivel verde.
- **Umbral para examen oficial: 80%** (`OFFICIAL_EXAM_THRESHOLD`) — a partir de este puntaje (inclusive) se muestra el enlace para realizar la prueba oficial en Oracle myLearn.
- El examen puede repetirse un número ilimitado de veces ("Take Exam Again"), generando cada vez una nueva selección aleatoria de preguntas y opciones.

### Revisión de resultados
- "Review Answers" permite recorrer **todas** las preguntas del intento (correctas e incorrectas), mostrando la opción elegida, la opción correcta resaltada y la explicación de por qué esa es la respuesta correcta (campo `explanation` del banco de preguntas).
- "Review Incorrect Questions" solo está disponible cuando el intento tuvo **al menos una respuesta incorrecta**, sin importar si el examen se aprobó o no — es decir, la disponibilidad de este botón depende de la cantidad de errores, no del resultado de aprobado/no aprobado.

## Configuración

Los parámetros de negocio están centralizados al inicio de `app.js` y pueden ajustarse sin tocar el resto de la lógica:

| Constante                 | Valor  | Significado                                            |
|----------------------------|--------|----------------------------------------------------------|
| `EXAM_LENGTH`              | 40     | Cantidad de preguntas por intento                         |
| `EXAM_DURATION_SECONDS`    | 3600   | Duración del examen (segundos)                            |
| `PASS_THRESHOLD`           | 0.65   | Puntaje mínimo para aprobar                                |
| `IMPROVE_THRESHOLD`        | 0.75   | Puntaje que separa el mensaje "puedes mejorar" (azul) del mensaje "casi listo" (verde) |
| `OFFICIAL_EXAM_THRESHOLD`  | 0.80   | Puntaje a partir del cual el alumno se considera "listo" y se muestra el enlace al examen oficial |
