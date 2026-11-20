/**
 * 统一 diff 的纯解析。本文件刻意不 import 任何模块（不依赖 React、传输层与 DOM），
 * 这样它既能在界面里用，也能用 `node --experimental-strip-types` 直接导入做离线校验。
 * 契约见 `Docs/frontends/README.md` §7。
 */

export type DiffRow =
  | { kind: "hunk"; text: string }
  | { kind: "add"; text: string; newNo: number }
  | { kind: "del"; text: string; oldNo: number }
  | { kind: "ctx"; text: string; oldNo: number; newNo: number };

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function diffStats(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  let inHunk = false;
  const lines = diff.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (HUNK_HEADER.test(line)) {
      inHunk = true;
      continue;
    }
    // 首个 hunk 之前全是文件头与元信息；hunk 内以 --/++ 开头的行是正文，必须计入
    if (!inHunk) continue;
    if (line.startsWith("+")) added += 1;
    else if (line.startsWith("-")) removed += 1;
  }
  return { added, removed };
}

export function parseUnifiedDiff(diff: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  const lines = diff.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? "";

    const hunk = HUNK_HEADER.exec(raw);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      inHunk = true;
      rows.push({ kind: "hunk", text: raw });
      continue;
    }

    // 文件头（diff --git / index / --- a/x / +++ b/x / rename …）只出现在第一个 hunk 之前
    if (!inHunk) continue;

    if (raw.startsWith("\\")) continue; // "\ No newline at end of file"

    if (raw.startsWith("+")) {
      rows.push({ kind: "add", text: raw, newNo });
      newNo += 1;
      continue;
    }
    if (raw.startsWith("-")) {
      rows.push({ kind: "del", text: raw, oldNo });
      oldNo += 1;
      continue;
    }
    // diff 文本以换行结尾，split 出的最后一个空串不是内容行，挂上去会多一行、且推错行号
    if (raw.length === 0 && index === lines.length - 1) continue;

    rows.push({ kind: "ctx", text: raw.startsWith(" ") ? raw : ` ${raw}`, oldNo, newNo });
    oldNo += 1;
    newNo += 1;
  }
  return rows;
}
