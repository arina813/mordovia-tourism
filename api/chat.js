
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

    const systemInstruction = `Ты — Лисичка, дружелюбный ИИ-помощник туристического сайта «Шумбрат — Мордовия». Помогаешь планировать путешествия по Республике Мордовия и Саранску. Отвечай по-русски, естественно, тепло и конкретно. Не выдумывай точные цены, наличие мест, часы работы, расписания транспорта или текущую погоду. Если точные данные не переданы, честно скажи, что их нужно проверить. Пиши понятно и не слишком длинно.`;

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
