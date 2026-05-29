import { GoogleGenAI } from "@google/genai";

const DEFAULT_REPLY =
  "ขออภัยนะคะ ไม้หอมไม่ทราบข้อมูลตรงนี้ค่ะ รบกวนติดต่อทางร้านโดยตรงได้เลยนะคะ";

const SYSTEM_PROMPT_TEMPLATE = `<role>
คุณคือ "ไม้หอม" พนักงานต้อนรับของร้านอาหารตามสั่ง MaiHorm
</role>

<constraints>
- ตอบโดยใช้ข้อมูลใน <faq> เท่านั้น
- ห้ามแต่งราคา เวลา ที่ตั้ง หรือเมนูที่ไม่มีใน FAQ
- ถ้าไม่มีข้อมูล ให้ตอบว่า "${DEFAULT_REPLY}" เท่านั้น ห้ามเพิ่มเติม
- โทน: สุภาพ ลงท้าย ค่ะ/นะคะ แต่เป็นกันเองเล็กน้อย ไม่แข็งทื่อ
- ความยาว: 1-3 ประโยคเท่านั้น
</constraints>

<output_format>
- ภาษาไทยเท่านั้น
- ห้ามใช้ markdown เช่น ** หรือ ##
- ห้ามขึ้นหัวข้อ
</output_format>

<faq>
{{FAQ}}
</faq>

<question>
{{QUESTION}}
</question>`;

export async function askGemini(
  userMessage: string,
  faqText: string
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("[gemini] GEMINI_API_KEY not set");
    return DEFAULT_REPLY;
  }

  const prompt = SYSTEM_PROMPT_TEMPLATE.replace("{{FAQ}}", faqText).replace(
    "{{QUESTION}}",
    userMessage
  );

  const ai = new GoogleGenAI({ apiKey });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        temperature: 1.0,
        maxOutputTokens: 1024,
      },
    });

    clearTimeout(timeout);

    const candidate = response.candidates?.[0];
    const finishReason = candidate?.finishReason ?? "UNKNOWN";
    const thoughtsTokenCount =
      response.usageMetadata?.thoughtsTokenCount ?? 0;
    const candidatesTokenCount =
      response.usageMetadata?.candidatesTokenCount ?? 0;

    console.log(
      `[gemini] finishReason=${finishReason} thoughts=${thoughtsTokenCount} candidates=${candidatesTokenCount}`
    );

    if (finishReason === "MAX_TOKENS") {
      console.warn(
        `[gemini] MAX_TOKENS hit — candidatesTokenCount=${candidatesTokenCount}`
      );
      return DEFAULT_REPLY;
    }

    const text = candidate?.content?.parts?.[0]?.text?.trim() ?? "";
    if (!text) return DEFAULT_REPLY;

    return text;
  } catch (err) {
    const isAbort =
      err instanceof Error && err.name === "AbortError";
    console.error(`[gemini] ${isAbort ? "timeout" : "error"}:`, err);
    return DEFAULT_REPLY;
  }
}
