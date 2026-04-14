// seed-demo-prod.mjs
import admin from "firebase-admin";
import fs from "node:fs";
import path from "node:path";

/**
 * ========= ここだけ設定 =========
 * ✅ 事故防止：この projectId のときだけ投入
 *    （nico-prod の Firebase projectId を入れる）
 */
const ALLOW_PROJECT_ID = "nico-prod-c637a"; // ★あなたの nico-prod の projectId に合わせて変更

// ✅ 投入量
const TOTAL_POSTS = 500;

// ✅ コメント数（投稿ごと）: 3〜50、ただしSNSっぽいロングテール分布にする
const COMMENT_MIN = 3;
const COMMENT_MAX = 50;

// ✅ リアクション数（postsの集計値）: 3〜1000、ロングテール
const REACT_MIN = 3;
const REACT_MAX = 1000;

// ✅ createdAt を過去N日へ散らす（数か月分の見た目）
const DAYS_RANGE = 120;

// ✅ seed識別（後で消す時に使う）
const SEED_TAG = "demo_seed_prod_v1";

// ✅ サービスアカウント鍵ファイル名（nico-app直下に置く）
const SERVICE_ACCOUNT_FILE = "serviceAccountKey.json";

/**
 * Firestore batch は最大 500 書き込みなので、余裕を持つ
 * （posts + commentsで使う）
 */
const BATCH_LIMIT = 450;
/* ============================= */

// 実行時ガード（YESが無いと止める）
function mustConfirm() {
  if (process.env.SEED_ALLOW !== "YES") {
    console.log("🛑 安全ガード: 実行するには環境変数 SEED_ALLOW=YES を付けてください");
    console.log('   例:  SEED_ALLOW=YES node seed-demo-prod.mjs');
    process.exit(1);
  }
}

// ランダムユーティリティ
const rInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[rInt(0, arr.length - 1)];
const maybe = (p) => Math.random() < p;

function randomUserId() {
  return "u_" + Math.random().toString(36).slice(2, 10);
}
function randomDateWithinDays(days) {
  const now = Date.now();
  const past = now - days * 24 * 60 * 60 * 1000;
  return new Date(past + Math.random() * (now - past));
}

// ロングテールっぽい数値（小が多く、大がたまに）
function longTail(min, max, aggressiveness = 0.9) {
  const u1 = Math.random() || 1e-9;
  const u2 = Math.random() || 1e-9;
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const x = Math.exp(z * aggressiveness);
  const scaled = Math.floor(min + (max - min) * Math.min(1, x / 8));
  return Math.min(max, Math.max(min, scaled));
}

/**
 * ===== 投稿文面の“部品化” =====
 * - 学生/社会人のテンプレを増やし
 * - 語尾・句読点・絵文字等でゆれを出す
 * - 同じ文面が連続しにくい（デモ向け）
 */
const studentA = ["課題", "レポート", "ゼミ発表", "サークル", "バイト", "就活", "履修", "研究室", "講義", "提出物", "グループワーク", "実験"];
const studentB = ["が重なって", "の期限が近くて", "の連絡が増えて", "の準備で", "のあとで", "のことで", "が思ったより長引いて", "が予定外に入って"];
const studentC = ["気づいたら時間が溶けてた", "思ったより手が進まない", "頭が回らない", "集中が切れがち", "予定が押してきた", "ちょっと詰んでる", "リズムが崩れた", "焦りが出てきた"];
const studentEnd = ["今日はここまで。", "明日巻き返す。", "一回深呼吸する。", "まあ一歩進んだ。", "いったん寝る。", "とりあえず落ち着く。", "無理せず進める。", "次は早めに着手したい。"];

const workerA = ["会議", "レビュー", "資料作成", "依頼対応", "調整", "進捗確認", "問い合わせ", "定例", "タスク整理", "フォロー", "障害対応", "メール処理"];
const workerB = ["が続いて", "が立て込んで", "の対応が入り", "の順番待ちが多く", "のリスケが発生して", "が想定以上に伸びて", "が細切れになって"];
const workerC = ["手が止まりがちだった", "集中時間を確保しづらかった", "優先度を見直す必要が出た", "予定通りに進まなかった", "細かい対応が積み上がった", "思考が分断された", "見落としが怖い日だった"];
const workerEnd = ["今日はここまで。", "明日は整理して臨む。", "次の一手を決めた。", "まずは着地を意識。", "いったん区切る。", "少し休んで再開。", "今日は守りに回った。", "明日は攻める。"];

const emojisSoft = ["", "", "🙂", "😅", "🙏", "💤", "✨", "🍵", "😮‍💨", "…"];
const postTone = ["achievement", "complaint", "neutral", "share"];

function buildPostText() {
  const isStudent = maybe(0.55);
  const tone = pick(postTone);

  let text = "";
  if (isStudent) {
    text =
      `${pick(studentA)}${pick(studentB)}${pick(studentC)}。` +
      (tone === "achievement" ? "ひとまず一区切りついた。" :
       tone === "complaint" ? "ちょっとしんどい。" :
       tone === "share" ? "同じ人いる？" : "") +
      ` ${pick(studentEnd)}${pick(emojisSoft)}`;
  } else {
    text =
      `${pick(workerA)}${pick(workerB)}${pick(workerC)}。` +
      (tone === "achievement" ? "一旦、目処が立った。" :
       tone === "complaint" ? "やや消耗。" :
       tone === "share" ? "こういう日、ありますよね。" : "") +
      ` ${pick(workerEnd)}${pick(emojisSoft)}`;
  }

  // 小さなゆれ（同一っぽさを弱める）
  if (maybe(0.25)) text = text.replace("。", "…");
  if (maybe(0.15)) text = text.replace("今日は", "きょうは");
  if (maybe(0.10)) text = text.replace("一旦", "いったん");

  return text;
}

function inferTone(text) {
  if (/(一区切り|目処|できた|進んだ|ひとまず|安心)/.test(text)) return "achievement";
  if (/(しんどい|つらい|消耗|詰んで|回らない|焦り)/.test(text)) return "complaint";
  if (/(同じ人いる|ありますよね)/.test(text)) return "share";
  return "neutral";
}

// コメント文（部品化＋投稿トーン整合）
const cEmpathy = ["わかる", "あるある", "同感", "自分も近い", "それはつらいね", "しんどいよね", "わかりみ"];
const cPraise = ["えらい", "すごい", "よくやった", "ちゃんと進んでる", "積み上がってる", "いい流れ", "ナイス"];
const cSupport = ["無理しすぎないで", "まず休んで", "応援してる", "少しずつでOK", "今日は十分", "ゆっくりいこう", "自分のペースで"];
const cTail = ["🙂", "🙏", "✨", "🍵", "😅", "", ""];

function buildCommentText(tone) {
  let parts = [];
  if (tone === "achievement") {
    if (maybe(0.75)) parts.push(pick(cPraise));
    if (maybe(0.60)) parts.push(pick(cSupport));
    if (maybe(0.25)) parts.push(pick(cEmpathy));
  } else if (tone === "complaint") {
    if (maybe(0.80)) parts.push(pick(cEmpathy));
    if (maybe(0.60)) parts.push(pick(cSupport));
    if (maybe(0.15)) parts.push(pick(cPraise));
  } else {
    if (maybe(0.55)) parts.push(pick(cEmpathy));
    if (maybe(0.50)) parts.push(pick(cSupport));
    if (maybe(0.30)) parts.push(pick(cPraise));
  }

  const base = parts.filter(Boolean).slice(0, rInt(1, 3)).join("。");
  const end = maybe(0.6) ? "。" : "";
  return `${base}${end}${pick(cTail)}`.replace("。。", "。");
}

// コメント数分布（大半少数、たまに多い）
function commentCountDist() {
  const p = Math.random();
  if (p < 0.80) return rInt(Math.max(COMMENT_MIN, 3), Math.min(COMMENT_MAX, 8));
  if (p < 0.95) return rInt(9, Math.min(COMMENT_MAX, 20));
  return rInt(Math.max(COMMENT_MIN, 21), COMMENT_MAX);
}

// リアクション数分布（大半少数、たまにバズ）
function reactionDist() {
  const p = Math.random();
  if (p < 0.85) return rInt(Math.max(REACT_MIN, 3), Math.min(REACT_MAX, 80));
  if (p < 0.97) return rInt(81, Math.min(REACT_MAX, 300));
  return rInt(Math.max(REACT_MIN, 301), REACT_MAX);
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

  // ✅ 事故防止ガード：想定以外の projectId では止める
  if (projectId !== ALLOW_PROJECT_ID) {
    console.log(`🛑 ガード発動: projectId=${projectId} は許可されていません。`);
    console.log(`   ALLOW_PROJECT_ID=${ALLOW_PROJECT_ID} に合わせるか、正しい鍵を使ってください。`);
    process.exit(1);
  }

  const db = admin.firestore();
  const postsCol = db.collection("posts");
  const commentsCol = db.collection("comments");

  let totalComments = 0;

  console.log(`Seeding posts=${TOTAL_POSTS} into ${projectId} ...`);

  let batch = db.batch();
  let ops = 0;

  for (let i = 0; i < TOTAL_POSTS; i++) {
    if (ops >= BATCH_LIMIT) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
      console.log(`Committed... posts=${i}/${TOTAL_POSTS}, comments=${totalComments}`);
    }

    const postRef = postsCol.doc();
    const postText = buildPostText();
    const tone = inferTone(postText);

    const createdAt = admin.firestore.Timestamp.fromDate(randomDateWithinDays(DAYS_RANGE));

    const wakaru = reactionDist();
    const sugoi = reactionDist();
    const erai = reactionDist();

    const commentCount = commentCountDist();

    batch.set(postRef, {
      content: postText,
      userId: randomUserId(),
      createdAt,
      commentCount,
      reactionCounts: { wakaru, sugoi, erai },

      // seed識別（あとで消す）
      seed: true,
      seedTag: SEED_TAG,
      seedTone: tone,
      seedInsertedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    ops++;

    // comments（実体doc）を commentCount 分だけ
    for (let c = 0; c < commentCount; c++) {
      if (ops >= BATCH_LIMIT) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
        console.log(`Committed... posts=${i}/${TOTAL_POSTS}, comments=${totalComments}`);
      }

      const commentRef = commentsCol.doc();

      // コメント時刻は投稿の後 10分〜7日で散らす
      const addMs = rInt(10 * 60 * 1000, 7 * 24 * 60 * 60 * 1000);
      const commentAt = new Date(createdAt.toDate().getTime() + addMs);

      batch.set(commentRef, {
        postId: postRef.id,
        userId: randomUserId(),
        content: buildCommentText(tone),
        createdAt: admin.firestore.Timestamp.fromDate(commentAt),

        seed: true,
        seedTag: SEED_TAG,
        seedTone: tone,
      });
      ops++;
      totalComments++;
    }
  }

  if (ops > 0) await batch.commit();

  console.log("✅ Seed completed.");
  console.log(`posts=${TOTAL_POSTS}, comments=${totalComments}`);
  console.log(`seedTag=${SEED_TAG} ← 削除スクリプトでこれを指定します`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});