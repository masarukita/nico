import Image from "next/image";

// ロゴコンポーネント（画像で表示）
export default function Logo() {
  return (
    <Image src="/logo_full.png" alt="nico" width={120} height={40} priority />
  );
}