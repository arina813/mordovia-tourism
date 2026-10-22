
module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "Используйте POST-запрос."
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || !apiKey.trim()) {
    console.error("LISICHKA_DIAG: GEMINI_API_KEY is missing");
    return res.status(500).json({
      error: "Сервер не получил GEMINI_API_KEY."
    });
  }

  const systemInstruction = `Ты — Лисичка, дружелюбный туристический помощник сайта «Шумбрат — Мордовия». Помогай планировать поездки по Саранску и Республике Мордовия.

Всегда давай полный, законченный ответ за одно сообщение. Не предлагай написать «продолжай». Для маршрута на день расписывай утро, обед, вторую половину дня и вечер, объясняй, что посмотреть, и добавляй практические советы.

Пиши естественным русским языком, тепло и без шаблонных вступлений. Не используй Markdown-разметку: символы #, звёздочки для выделения и списков, обратные кавычки и таблицы. Используй обычные названия разделов и короткие абзацы.

Учитывай предыдущие сообщения. Не задавай лишних вопросов, если можешь предложить разумный вариант. Не выдумывай цены, расписания, часы работы, наличие мест и текущую погоду.`;

  const sleep = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

  async function readJson(response) {
    return response.json().catch(() => ({}));
  }

  function extractGeminiText(data) {
    return (data?.candidates?.[0]?.content?.parts || [])
      .map(part => part.text || "")
      .join("\n")
      .trim();
  }

  function extractAgentText(data) {
    if (typeof data?.output_text === "string") {
      return data.output_text.trim();
    }

    const steps = Array.isArray(data?.steps) ? data.steps : [];

    return steps
      .filter(step => step.type === "model_output")
      .flatMap(step => step.content || [])
      .filter(part => part.type === "text" && part.text)
      .map(part => part.text)
      .join("\n")
      .trim();
  }

  try {
    const incoming = Array.isArray(req.body?.messages)
      ? req.body.messages
      : [];

    const contents = incoming
      .filter(m =>
        (m.role === "user" || m.role === "model") &&
        Array.isArray(m.parts)
      )
      .slice(-12)
      .map(m => ({
        role: m.role,
        parts: m.parts
          .filter(p => p && typeof p.text === "string")
          .map(p => ({ text: p.text.slice(0, 4000) }))
      }))
      .filter(m => m.parts.some(p => p.text.trim()));

    if (!contents.length || !contents.some(m => m.role === "user")) {
      return res.status(400).json({
        error: "Напишите сообщение Лисичке."
      });
    }

    // 1. Сначала пробуем обычный Gemini.
    let geminiResponse = null;
    let geminiData = {};
    let geminiError = null;

    try {
      geminiResponse = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey.trim()
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: systemInstruction }]
            },
            contents,
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 1800
            }
          }),
          signal: AbortSignal.timeout(15000)
        }
      );

      geminiData = await readJson(geminiResponse);

      if (geminiResponse.ok) {
        const reply = extractGeminiText(geminiData);

        if (reply) {
          console.log("LISICHKA_DIAG: Gemini success");
          return res.status(200).json({ reply });
        }

        geminiError = "Gemini вернул пустой ответ";
      } else {
        console.error(
          "LISICHKA_DIAG: Gemini HTTP",
          geminiResponse.status,
          geminiData?.error?.message || "Описание ошибки отсутствует"
        );
      }
    } catch (error) {
      geminiError = error?.name === "TimeoutError" ||
        error?.name === "AbortError"
        ? "Gemini timeout"
        : (error?.message || "Сетевая ошибка Gemini");

      console.error("LISICHKA_DIAG: Gemini network error", geminiError);
    }

    const status = geminiResponse?.status;

    // Резерв включаем только при 503 или сетевом тайм-ауте/сбое.
    const shouldFallback =
  status === 429 ||
  status === 503 ||
  !geminiResponse ||
  geminiError === "Gemini timeout" ||
  geminiError === "Сетевая ошибка Gemini";

    if (!shouldFallback) {
      if (status === 429) {
        return res.status(502).json({
          error: "Превышен лимит запросов Gemini. Попробуйте позже."
        });
      }

      if (status === 401 || status === 403) {
        return res.status(502).json({
          error: "Gemini отклонил запрос. Проверьте API-ключ и доступ."
        });
      }

      return res.status(502).json({
        error: "Gemini не смог сформировать ответ. Попробуйте ещё раз."
      });
    }

    // 2. Резерв: Antigravity Agent через Interactions API.
    console.log("LISICHKA_DIAG: switching to Antigravity");

    const conversation = contents.map(message => {
      const role = message.role === "model" ? "Лисичка" : "Пользователь";
      const text = message.parts.map(part => part.text).join("\n");
      return `${role}: ${text}`;
    }).join("\n\n");

    const agentResponse = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey.trim()
        },
        body: JSON.stringify({
  agent: "antigravity-preview-09-2026",
  environment: "remote",
  agent_config: { type: "antigravity" },
          system_instruction: systemInstruction,
          input: conversation,
          store: true
        }),
        signal: AbortSignal.timeout(45000)
      }
    );

    const agentData = await readJson(agentResponse);

    if (!agentResponse.ok) {
      console.error(
        "LISICHKA_DIAG: Antigravity HTTP",
        agentResponse.status,
        agentData?.error?.message || "Описание ошибки отсутствует"
      );

      return res.status(502).json({
        error: "Gemini временно недоступен, а резервный агент тоже не смог ответить. Попробуйте ещё раз через минуту."
      });
    }

    const reply = extractAgentText(agentData);

    if (!reply) {
      console.error(
        "LISICHKA_DIAG: Antigravity returned no text",
        agentData?.status || "unknown status"
      );

      return res.status(502).json({
        error: "Резервный агент не вернул готовый ответ. Попробуйте ещё раз."
      });
    }

    console.log("LISICHKA_DIAG: Antigravity success");
    return res.status(200).json({ reply });

  } catch (error) {
    console.error(
      "LISICHKA_DIAG: internal error",
      error?.message || String(error)
    );

    return res.status(502).json({
      error: "Лисичка временно недоступна. Попробуйте ещё раз немного позже."
    });
  }
};
