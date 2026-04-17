import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/reactions/status?postId=xxx&userId=yyy
 * reactions/{postId}_{userId} が存在するかを返す
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const postId = String(url.searchParams.get("postId") ?? "");
    const userId = String(url.searchParams.get("userId") ?? "");

    if (!postId || !userId) {
      return NextResponse.json({ ok: false, reason: "missing_input" }, { status: 400 });
    }

    // Admin SDK を遅延import（環境差/初期化順の事故を減らす）
    const mod = await import("@/lib/firebase/admin");
    const db = mod.getAdminDb();

    const reactionId = `${postId}_${userId}`;
    const snap = await db.collection("reactions").doc(reactionId).get();

    return NextResponse.json({ ok: true, liked: snap.exists });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, reason: "internal", message: e?.message || String(e) },
      { status: 500 }
    );
  }
}