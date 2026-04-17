// utils/timeAgo.ts
// Firestore Timestamp / Date / number / string を受けて "2m" "3h" "1d" 形式にする

type FirestoreTimestampLike = {
  toDate?: () => Date;
  seconds?: number;
  nanoseconds?: number;
};

function toDateSafe(value: any): Date | null {
  if (!value) return null;

  // Firestore Timestamp
  if (typeof value?.toDate === "function") {
    try {
      return value.toDate();
    } catch {
      // fallthrough
    }
  }

  // seconds/nanoseconds
  if (typeof value?.seconds === "number") {
    return new Date(value.seconds * 1000);
  }

  // Date
  if (value instanceof Date) return value;

  // number (ms)
  if (typeof value === "number") return new Date(value);

  // string
  if (typeof value === "string") {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}

export function timeAgo(value: FirestoreTimestampLike | Date | number | string | null | undefined): string {
  const d = toDateSafe(value);
  if (!d) return "";

  const now = Date.now();
  const diff = Math.max(0, now - d.getTime());

  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s`;

  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;

  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;

  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;

  // 1週間以上は日付表示（X風）
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd}`;
}