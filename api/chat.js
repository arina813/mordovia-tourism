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
      error: "Сервер не получил GEMINI_API_KEY. Проверьте настройки Vercel."
    });
  }

  try {
    const incoming = Array.isArray(req.body && req.body.messages)
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

    const systemInstruction = `Ты — Лисичка, дружелюбный туристический помощник сайта «Шумбрат — Мордовия». Помогай планировать поездки по Саранску и Республике Мордовия.

Главное правило: всегда старайся дать ПОЛНЫЙ, ЗАКОНЧЕННЫЙ ответ за одно сообщение. Не дели ответ на части и никогда не предлагай пользователю написать «продолжай», чтобы получить оставшуюся информацию. Не обрывай маршрут на середине.

Если пользователь просит составить маршрут на день, сразу распиши весь день: утро, обед, вторая половина дня и вечер. Для каждой остановки кратко объясни, что там посмотреть и зачем туда идти. В конце дай несколько практических советов.

Если пользователь просит подробный план, включай все основные пункты сразу. Если информации много, сокращай второстепенные подробности, но сохраняй целостность ответа.

Пиши естественным русским языком, тепло и без шаблонных вступлений. Не используй Markdown-разметку: символы #, звёздочки для выделения и списков, обратные кавычки и таблицы. Используй обычные названия разделов и короткие абзацы.

Учитывай предыдущие сообщения и не заставляй пользователя повторять уже сообщённые пожелания. Если данных достаточно, не задавай лишних вопросов — предложи разумный вариант и при необходимости укажи свои предположения.

Не выдумывай точные цены, расписания, часы работы, наличие мест и текущую погоду. Если эти сведения неизвестны, предупреди, что их нужно проверить перед поездкой.`;

    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent";

    const requestBody = {
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      },
      contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1800
      }
    };

    let result = null;
    let lastStatus = 0;

    // Максимум 3 попытки при временных ошибках.
    for (let attempt = 0; attempt < 3; attempt++) {
      let response;

      try {
        console.log(
          `LISICHKA_DIAG: Gemini attempt ${attempt + 1}/3`
        );

        response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey.trim()
          },
          body: JSON.stringify(requestBody)
        });
      } catch (networkError) {
        console.error(
          "LISICHKA_DIAG: network error",
          networkError?.message || String(networkError)
        );

        if (attempt === 2) {
          return res.status(502).json({
            error: "Не удалось связаться с Gemini. Попробуйте ещё раз через минуту."
          });
        }

        await new Promise(resolve =>
          setTimeout(resolve, 1000 * (attempt + 1))
        );
        continue;
      }

      lastStatus = response.status;
      result = await response.json().catch(() => ({}));

      if (response.ok) {
        break;
      }

      const temporaryError =
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500;

      const googleMessage =
        result?.error?.message || "Описание ошибки отсутствует";

      console.error(
        "LISICHKA_DIAG: Gemini HTTP",
        response.status,
        googleMessage
      );

      if (!temporaryError || attempt === 2) {
        if (response.status === 503 || response.status >= 500) {
          return res.status(502).json({
            error: "Gemini временно перегружен. Подождите немного и отправьте сообщение ещё раз."
          });
        }

        if (response.status === 429) {
          return res.status(502).json({
            error: "Временно превышен лимит запросов Gemini. Попробуйте позже."
          });
        }

        return res.status(502).json({
          error: `Ошибка Gemini (${response.status}). Проверьте настройки API и журналы Vercel.`
        });
      }

      // Паузы между попытками: 1 секунда, затем 2 секунды.
      await new Promise(resolve =>
        setTimeout(resolve, 1000 * (attempt + 1))
      );
    }

    if (lastStatus && (lastStatus < 200 || lastStatus >= 300)) {
      return res.status(502).json({
        error: "Gemini пока не отвечает. Попробуйте ещё раз немного позже."
      });
    }

    const reply = (result?.candidates?.[0]?.content?.parts || [])
      .map(p => p.text || "")
      .join("\n")
      .trim();

    if (!reply) {
      console.error(
        "LISICHKA_DIAG: Gemini returned no text",
        JSON.stringify(result?.promptFeedback || {})
      );

      return res.status(502).json({
        error: "Gemini не вернул текстовый ответ. Попробуйте задать вопрос ещё раз."
      });
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
