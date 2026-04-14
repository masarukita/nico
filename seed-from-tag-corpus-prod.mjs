// seed-from-tag-corpus-prod.mjs
import admin from "firebase-admin";
import fs from "node:fs";
import path from "node:path";

const SERVICE_ACCOUNT_FILE = "serviceAccountKey.json";

// ★あなたの本番プロジェクトIDに合わせる（例：nico-prod-c637a）
const ALLOW_PROJECT_ID = "nico-prod-c637a";

// 後で消すための識別
const SEED_TAG = "demo_tag_seed_v1";

// 投稿数
const TOTAL_POSTS = 500;

// コメント数（投稿あたり）
const COMMENT_MIN = 3;
const COMMENT_MAX = 50;

// createdAt を過去何日へ散らすか
const DAYS_RANGE = 120;

// Firestore batch制限（最大500）に余裕
const BATCH_LIMIT = 450;

// コーパスフォルダ
const CORPUS_DIR = "seed_corpus";

// ---------------------
function mustConfirm() {
  if (process.env.SEED_ALLOW !== "YES") {
    console.log("🛑 安全ガード: SEED_ALLOW=YES を付けて実行してください");
    console.log('   例: $env:SEED_ALLOW="YES"; node seed-from-tag-corpus-prod.mjs');
    process.exit(1);
  }
}

const rInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

function randomUserId() {
  return "u_" + Math.random().toString(36).slice(2, 10);
}

function randomDateWithinDays(days) {
  const now = Date.now();
  const past = now - days * 24 * 60 * 60 * 1000;
  return new Date(past + Math.random() * (now - past));
}

function loadLines(filePath) {
  const text = fs.readFileSync(filePath, "utf-8");
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// [TAG] 本文 形式を解析
function parseTaggedLine(line) {
  const m = line.match(/^\[(\w+)\]\s*(.+)$/);
  if (!m) return { tag: "ANY", text: line.trim() };
  return { tag: m[1], text: m[2].trim() };
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// タグごとにプールを作る（重複少なめ）
function createTaggedPools(taggedItems) {
  const byTag = new Map();
  for (const it of taggedItems) {
    if (!byTag.has(it.tag)) byTag.set(it.tag, []);
    byTag.get(it.tag).push(it.text);
  }

  // 取り出し用Bag
  const bags = new Map();
  for (const [tag, texts] of byTag.entries()) {
    bags.set(tag, shuffle(texts));
  }

  function next(tag) {
    if (!bags.has(tag) || bags.get(tag).length === 0) {
      const texts = byTag.get(tag) || [];
      bags.set(tag, shuffle(texts));
    }
    const bag = bags.get(tag);
    if (!bag || bag.length === 0) return null;
    return bag.pop();
  }

  return { byTag, next };
}

// コメント数の分布（SNSっぽい：大半少数、たまに多い）
function commentCountDist() {
  const p = Math.random();
  if (p < 0.80) return rInt(Math.max(COMMENT_MIN, 3), Math.min(COMMENT_MAX, 8));
  if (p < 0.95) return rInt(9, Math.min(COMMENT_MAX, 20));
  return rInt(Math.max(COMMENT_MIN, 21), COMMENT_MAX);
}

// リアクションの分布（SNSっぽいロングテール）
function reactionDist() {
  const p = Math.random();
  if (p < 0.85) return rInt(3, 80);
  if (p < 0.97) return rInt(81, 300);
  return rInt(301, 1000);
}

async function main() {
  mustConfirm();

  const keyPath = path.resolve(process.cwd(), SERVICE_ACCOUNT_FILE);
  if (!fs.existsSync(keyPath)) {
    console.log(`🛑 ${SERVICE_ACCOUNT_FILE} が見つかりません（nico-app直下に置いてください）`);
    process.exit(1);
  }

  const serviceAccount = JSON.parse(fs.readFileSync(keyPath, "utf-8"));
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

  const projectId = serviceAccount.project_id;
  console.log("Target projectId:", projectId);

  if (projectId !== ALLOW_PROJECT_ID) {
    console.log(`🛑 ガード発動: projectId=${projectId} は許可されていません。`);
    process.exit(1);
  }

  // コーパス読み込み（タグ付き）
  const corpusBase = path.resolve(process.cwd(), CORPUS_DIR);

  const postsStudentRaw = loadLines(path.join(corpusBase, "posts_student.txt")).map(parseTaggedLine);
  const postsWorkerRaw  = loadLines(path.join(corpusBase, "posts_worker.txt")).map(parseTaggedLine);

  const cShortRaw  = loadLines(path.join(corpusBase, "comments_short.txt")).map(parseTaggedLine);
  const cLongRaw   = loadLines(path.join(corpusBase, "comments_long.txt")).map(parseTaggedLine);
  const cFinishRaw = loadLines(path.join(corpusBase, "comments_finish.txt")).map(parseTaggedLine);

  if (postsStudentRaw.length + postsWorkerRaw.length < 50) {
    console.log("🛑 投稿素材が少なすぎます。posts_student/posts_worker を増やしてください。");
    process.exit(1);
  }
  if (cShortRaw.length < 10 || cLongRaw.length < 10 || cFinishRaw.length < 5) {
    console.log("🛑 コメント素材が少なすぎます。comments_* を増やしてください。");
    process.exit(1);
  }

  // 投稿プール（学生/社会人を混ぜる）
  const allPosts = shuffle([...postsStudentRaw, ...postsWorkerRaw]);

  // コメントはタグごとプール化
  const shortPools  = createTaggedPools(cShortRaw);
  const longPools   = createTaggedPools(cLongRaw);
  const finishPools = createTaggedPools(cFinishRaw);

  // 便利関数：tagに一致する候補が無ければANYへフォールバック
  function pickCommentText(tag, mode) {
    const pools = mode === "short" ? shortPools : mode === "long" ? longPools : finishPools;

    // tag一致 → だめならANY
    let t = pools.next(tag);
    if (!t) t = pools.next("ANY");
    // それでも無ければ、全タグから適当に（最終保険）
    if (!t) {
      const anyText = pools.byTag.get("ANY");
      if (anyText && anyText.length) t = anyText[Math.floor(Math.random() * anyText.length)];
    }
    return t || "応援してる。";
  }

  const db = admin.firestore();
  const postsCol = db.collection("posts");
  const commentsCol = db.collection("comments");

  console.log(`Seeding posts=${TOTAL_POSTS} (tag-matched) ...`);

  let batch = db.batch();
  let ops = 0;
  let totalComments = 0;

  for (let i = 0; i < TOTAL_POSTS; i++) {
    if (ops >= BATCH_LIMIT) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
      console.log(`Committed... posts=${i}/${TOTAL_POSTS}, comments=${totalComments}`);
    }

    const post = allPosts[i % allPosts.length]; // 足りなければ循環（タグ付きなので被りは小さめ）
    const tag = post.tag || "ANY";
    const postText = post.text;

    const createdAt = admin.firestore.Timestamp.fromDate(randomDateWithinDays(DAYS_RANGE));
    const commentCount = commentCountDist();

    const postRef = postsCol.doc();
    batch.set(postRef, {
      content: postText,
      userId: randomUserId(),
      createdAt,
      commentCount, // 一旦 → 最後に実数でupdate
      reactionCounts: {
        wakaru: reactionDist(),
        sugoi: reactionDist(),
        erai: reactionDist(),
      },
      seed: true,
      seedTag: SEED_TAG,
      seedTopic: tag,
      seedInsertedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    ops++;

    // コメント作成（投稿タグに合わせて short→long→finish の比率で）
    let made = 0;
    for (let c = 0; c < commentCount; c++) {
      if (ops >= BATCH_LIMIT) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
        console.log(`Committed... posts=${i}/${TOTAL_POSTS}, comments=${totalComments}`);
      }

      const commentRef = commentsCol.doc();

      const addMs = rInt(10 * 60 * 1000, 7 * 24 * 60 * 60 * 1000);
      const commentAt = new Date(createdAt.toDate().getTime() + addMs);

      // 文章構成：短45% / 中長40% / 長15%
      const p = Math.random();
      let text;
      if (p < 0.45) {
        text = pickCommentText(tag, "short");
      } else if (p < 0.85) {
        text = (pickCommentText(tag, "long") + " " + pickCommentText(tag, "short")).trim();
      } else {
        text = (pickCommentText(tag, "long") + " " + pickCommentText(tag, "long") + " " + pickCommentText(tag, "finish")).trim();
      }

      batch.set(commentRef, {
        postId: postRef.id,
        userId: randomUserId(),
        content: text,
        createdAt: admin.firestore.Timestamp.fromDate(commentAt),
        seed: true,
        seedTag: SEED_TAG,
        seedTopic: tag,
      });
      ops++;
      totalComments++;
      made++;
    }

    // commentCount を実際に入れた件数へ（ズレ防止）
    if (ops >= BATCH_LIMIT) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
    batch.update(postRef, { commentCount: made });
    ops++;
  }

  if (ops > 0) await batch.commit();

  console.log("✅ Seed completed (tag-matched).");
  console.log(`posts=${TOTAL_POSTS}, comments=${totalComments}, seedTag=${SEED_TAG}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});