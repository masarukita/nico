import { NextResponse } from "next/server";
import { getAdminDb, admin } from "@/lib/firebase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "/api/reactions/toggle",
    methods: ["GET", "POST"],
    adminProjectId: process.env.FIREBASE_PROJECT_ID || null,
  });
}

export async function POST(req: Request) {
  const adminProjectId = process.env.FIREBASE_PROJECT_ID || null;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "bad_json", adminProjectId }, { status: 400 });
  }

  const postId = String(body?.postId ?? "");
  const userId = String(body?.userId ?? "");
  const type = String(body?.type ?? "like");

  if (!postId || !userId) {
    return NextResponse.json({ ok: false, reason: "missing_input", adminProjectId }, { status: 400 });
  }

  try {
    const db = getAdminDb();
    const postRef = db.collection("posts").doc(postId);
    const reactionId = `${postId}_${userId}`;
    const reactionRef = db.collection("reactions").doc(reactionId);

    // まず存在確認（ここで not found を 404 で返す）
    const postSnap = await postRef.get();
    if (!postSnap.exists) {
      return NextResponse.json(
        { ok: false, reason: "post_not_found", postId, adminProjectId },
        { status: 404 }
      );
    }

    // ここからトグル（transaction）
    const result = await db.runTransaction(async (tx) => {
      const postSnap2 = await tx.get(postRef);
      const postData = postSnap2.data() as any;

      const cur = Number(postData?.reactionCounts?.wakaru ?? 0);

      const reactSnap = await tx.get(reactionRef);
      const alreadyLiked = reactSnap.exists;

      const nextLiked = !alreadyLiked;
      const nextCount = Math.max(0, cur + (nextLiked ? 1 : -1));

      if (nextLiked) {
        tx.set(reactionRef, {
          postId,
          userId,
          type,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } else {
        tx.delete(reactionRef);
      }

      tx.update(postRef, {
        "reactionCounts.wakaru": nextCount,
        lastActivityAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return { liked: nextLiked, count: nextCount };
    });

    return NextResponse.json({
      ok: true,
      liked: result.liked,
      count: result.count,
      adminProjectId,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, reason: "internal", message: e?.message || String(e), adminProjectId },
      { status: 500 }
    );
  }
}