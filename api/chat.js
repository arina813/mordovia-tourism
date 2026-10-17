module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Используйте POST-запрос." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "На сервере не настроен GEMINI_API_KEY." });
  }

  try {
    const incoming = Array.isArray(req.body && req.body.messages) ? req.body.messages : [];
    const contents = incoming
      .filter(m => (m.role === "user" || m.role === "model") && Array.isArray(m.parts))
      .slice(-12)
      .map(m => ({ role: m.role, parts: m.parts.map(p => ({ text: String(p.text || "").slice(0, 4000) })) }))
      .filter(m => m.parts.some(p => p.text.trim()));

    if (!contents.length || !contents.some(m => m.role === "user")) {
      return res.status(400).json({ error: "Напишите сообщение Лисичке." });
    }

    const systemInstruction = `Ты — Лисичка, дружелюбный ИИ-помощник туристического сайта «Шумбрат — Мордовия». Помогаешь планировать путешествия по Республике Мордовия и Саранску. Отвечай по-русски, естественно, тепло и конкретно. Генерируй новый ответ на каждый запрос, не повторяй одну и ту же заготовку. Уточняй бюджет, даты, количество дней, состав путешественников и интересы, если это важно. Предлагай понятные варианты маршрутов, идеи на разную погоду, природу, культуру эрзя и мокша, музеи, семейный отдых и местную кухню. Не выдумывай точные цены, наличие мест, часы работы, расписания транспорта или текущую погоду. Если точные данные не переданы в сообщении, честно скажи, что их нужно проверить перед поездкой. Используй сведения из переписки, не утверждай, что проверила сайт или интернет, если этого не делала. Пиши структурированно, но не слишком длинно; при планировании маршрута указывай последовательность остановок и кратко объясняй выбор.`;

    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents,
        generationConfig: { temperature: 0.9, maxOutputTokens: 900 }
      })
    });

    const result = await response.json();
    if (!response.ok) {
      console.error("Gemini API error:", response.status, JSON.stringify(result).slice(0, 1500));
      return res.status(502).json({ error: "Gemini API не принял запрос. Проверь ключ, доступ к модели и лимиты API." });
    }
    const reply = (result.candidates && result.candidates[0] && result.candidates[0].content && result.candidates[0].content.parts || [])
      .map(p => p.text || "").join("\n").trim();
    if (!reply) return res.status(502).json({ error: "Gemini не вернул текстовый ответ." });
    return res.status(200).json({ reply });
  } catch (error) {
    console.error("Lisichka API route error:", error);
    return res.status(500).json({ error: "Внутренняя ошибка при создании ответа." });
  }
};
