import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { messagingApi } from "@line/bot-sdk";
import { fetchFaq, faqToText } from "@/lib/sheet";
import { askGemini } from "@/lib/gemini";

// Human takeover mode — เก็บ userId ที่อยู่ใน human mode
const humanModeUsers = new Set<string>();
const DEFAULT_REPLY =
  "ขออภัยนะคะ ไม้หอมไม่ทราบข้อมูลตรงนี้ค่ะ รบกวนติดต่อทางร้านโดยตรงได้เลยนะคะ";
async function notifyOwner(userMessage: string) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "";
  const ownerId = process.env.LINE_OWNER_USER_ID ?? "";
  console.log(`[notify] ownerId=${ownerId} message=${userMessage}`);
  if (!ownerId) return;

  await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: ownerId,
      messages: [{
        type: "text",
        text: `🔔 ลูกค้าถามแต่ไม้หอมตอบไม่ได้\n"${userMessage}"`,
      }],
    }),
  });
}
function verifySignature(body: string, signature: string): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET ?? "";
  console.log(`[debug] secret_length=${secret.length} secret_last4=${secret.slice(-4)}`);
  const hash = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("base64");
  return hash === signature;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-line-signature") ?? "";

  if (!verifySignature(rawBody, signature)) {
    console.warn(
      `[webhook] invalid signature — ip=${req.headers.get("x-forwarded-for") ?? "unknown"}`
    );
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { events?: unknown[] };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Bad Request" }, { status: 400 });
  }

  const events = body.events ?? [];
  const textEvents = events.filter(isLineTextMessageEvent);

  if (textEvents.length === 0) {
    return NextResponse.json({ ok: true });
  }

  const client = new messagingApi.MessagingApiClient({
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "",
  });

  const faqEntries = await fetchFaq();
  const faqText = faqToText(faqEntries);

  await Promise.all(
    textEvents.map(async (event) => {
      const userMessage = event.message.text;
      const replyToken = event.replyToken;

      // ── Human takeover commands ──
    const userId = (event as Record<string, unknown>).source?.userId as string ?? "";
    if (userMessage === "/human") {
      humanModeUsers.add(userId);
      await client.replyMessage({ replyToken, messages: [{ type: "text", text: "✅ สลับเป็นโหมดคนตอบแล้วค่ะ พิมพ์ /bot เพื่อให้ไม้หอมกลับมาตอบนะคะ" }] });
      return;
    }
    if (userMessage === "/bot") {
      humanModeUsers.delete(userId);
      await client.replyMessage({ replyToken, messages: [{ type: "text", text: "✅ ไม้หอมกลับมาตอบแทนแล้วนะคะ 😊" }] });
      return;
    }
    if (humanModeUsers.has(userId)) return;
      let replyText: string;
      try {
        replyText = await askGemini(userMessage, faqText);
        if (replyText === DEFAULT_REPLY) {
    await notifyOwner(userMessage);
}
      } catch (err) {
        console.error("[webhook] askGemini threw:", err);
        replyText = DEFAULT_REPLY;
        await notifyOwner(userMessage);
      }

      try {
        await client.replyMessage({
          replyToken,
          messages: [{ type: "text", text: replyText }],
        });
      } catch (err) {
        // log but don't throw — prevents Vercel retry loop
        console.error(
          `[webhook] replyMessage failed replyToken=${replyToken}:`,
          err
        );
      }
    })
  );

  return NextResponse.json({ ok: true });
}

// ── type helpers ──────────────────────────────────────────────────────────────

interface LineTextMessageEvent {
  type: "message";
  replyToken: string;
  message: { type: "text"; text: string };
}

function isLineTextMessageEvent(e: unknown): e is LineTextMessageEvent {
  if (typeof e !== "object" || e === null) return false;
  const ev = e as Record<string, unknown>;
  if (ev.type !== "message") return false;
  const msg = ev.message as Record<string, unknown> | undefined;
  return msg?.type === "text" && typeof msg?.text === "string";
}
