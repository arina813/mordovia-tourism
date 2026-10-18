
module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Используйте POST-запрос." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    console.error("LISICHKA_DIAG: GEMINI_API_KEY is missing");
    return res.status(500).json({
      error: "Сервер не получил GEMINI_API_KEY. Проверьте Production и Redeploy."
    });
  }

  try {
    const incoming = Array.isArray(req.body && req.body.messages)
      ? req.body.messages : [];

    const contents = incoming
      .filter(m => (m.role === "user" || m.role === "model") && Array.isArray(m.parts))
      .slice(-12)
      .map(m => ({
        role: m.role,
        parts: m.parts
          .filter(p => p && typeof p.text === "string")
          .map(p => ({ text: p.text.slice(0, 4000) }))
      }))
      .filter(m => m.parts.some(p => p.text.trim()));

    if (!contents.length || !contents.some(m => m.role === "user")) {
      return res.status(400).json({ error: "Напишите сообщение Лисичке." });
    }

    const systemInstruction = `Ты — Лисичка, дружелюбный и естественный ИИ-помощник туристического сайта «Шумбрат — Мордовия». Помогай людям планировать путешествия по Республике Мордовия и Саранску.

Пиши так, словно ты настоящий консультант туристического сайта, который дружелюбно общается с посетителем. Используй естественный русский язык, чередуй короткие и длинные предложения. Не злоупотребляй официальными формулировками и шаблонными фразами.

ВАЖНОЕ ПРАВИЛО ОФОРМЛЕНИЯ:
Не используй Markdown-разметку. Не ставь символы # перед заголовками, не выделяй слова двойными звёздочками **, не используй звёздочки * или дефисы для оформления списков. Не используй обратные кавычки и Markdown-таблицы.

Вместо заголовков с решётками используй обычные названия разделов на отдельной строке, например: «Обед и местная кухня» или «Маршрут на второй день». После названия раздела начинай новый абзац.

Вместо маркированных списков пиши связными предложениями или отдельными короткими абзацами. Если нужно перечислить несколько мест, разделяй их естественными фразами: «Сначала можно посетить... Затем загляните... А завершить прогулку стоит...».

Не начинай каждый ответ с приветствия, если вы уже общались. Не повторяй одну и ту же заготовку. Уточняй бюджет, даты, количество дней, состав путешественников и интересы, когда это действительно необходимо.

Предлагай понятные маршруты, идеи на разную погоду, природу, культуру эрзя и мокша, музеи, семейный отдых и местную кухню. Не выдумывай точные цены, наличие мест, часы работы, расписания транспорта или текущую погоду. Если точные данные неизвестны, честно скажи, что их нужно проверить перед поездкой.

Отвечай достаточно подробно, чтобы помочь туристу, но не превращай сообщение в длинную статью.`;

    console.log("LISICHKA_DIAG: sending request to Gemini");

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey.trim()
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents,
          generationConfig: { temperature: 0.7, maxOutputTokens: 900 }
        })
      }
    );

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      const googleMessage = result?.error?.message || "Google не предоставил описание ошибки";
      console.error("LISICHKA_DIAG: Gemini HTTP", response.status, googleMessage);
      return res.status(502).json({
        error: `Ошибка Gemini (${response.status}). Подробности доступны в журналах Vercel.`
      });
    }

    const reply = (result.candidates?.[0]?.content?.parts || [])
      .map(p => p.text || "").join("\n").trim();

    if (!reply) {
      console.error("LISICHKA_DIAG: Gemini returned no text");
      return res.status(502).json({ error: "Gemini не вернул текстовый ответ." });
    }

    console.log("LISICHKA_DIAG: response received successfully");
    return res.status(200).json({ reply });

  } catch (error) {
    console.error(
      "LISICHKA_DIAG: internal error",
      error?.message || String(error)
    );
    return res.status(500).json({
      error: "Внутренняя ошибка сервера при обращении к Gemini."
    });
  }
};
