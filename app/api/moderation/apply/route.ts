import { NextResponse } from "next/server";
import { getAdminDb, admin } from "@/lib/firebase/admin";

function requireAdmin(req: Request) {
  const token = process.env.MODERATION_ADMIN_TOKEN;
  if (!token) throw new Error("MODERATION_ADMIN_TOKEN missing");

  const h = req.headers.get("x-admin-token") || "";
  if (h !== token) return false;
  return true;
}

export async function POST(req: Request) {
  if (!requireAdmin(req)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const db = getAdminDb();

  // status == "allow" の pending を少しずつ処理（最大50件）
  const snap = await db.collection("comments_pending")
    .where("status", "==", "allow")
    .limit(50)
    .get();

  if (snap.empty) {
    return NextResponse.json({ ok: true, applied: 0 });
  }

  let applied = 0;

  for (const docSnap of snap.docs) {
    const p = docSnap.data() as any;

    const postId = String(p.postId ?? "");
    const userId = String(p.userId ?? "");
    const content = String(p.content ?? "");

    if (!postId || !content) {
      // 不正データは deny 扱いにしてスキップ
      await docSnap.ref.update({
        status: "deny",
        decidedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      continue;
    }

    const postRef = db.collection("posts").doc(postId);
    const pendingRef = docSnap.ref;

    await db.runTransaction(async (tx) => {
      const post = await tx.get(postRef);
      if (!post.exists) {
        tx.update(pendingRef, {
          status: "deny",
          decidedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return;
      }

      const curCount = Number((post.data() as any)?.commentCount ?? 0);

      const newCommentRef = db.collection("comments").doc();
      tx.set(newCommentRef, {
        postId,
        userId,
        content,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      tx.update(postRef, { commentCount: curCount + 1 });

      tx.update(pendingRef, {
        status: "applied",
        appliedAt: admin.firestore.FieldValue.serverTimestamp(),
        appliedCommentId: newCommentRef.id,
      });

      applied += 1;
    });
  }

  return NextResponse.json({ ok: true, applied });
}