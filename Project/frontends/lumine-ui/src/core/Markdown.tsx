import { Fragment, memo } from "react";

/**
 * 极简 Markdown：只解析后端会输出的四类排版单元（标题/列表/代码/引用）+ 表格。
 * 刻意不引入 md 库：十种风格要能在同一个 AST 上对齐比较，也不给包体积添负担。
 */
type Block =
  | { kind: "heading"; level: 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "code"; lang: string; text: string }
  | { kind: "table"; head: string[]; body: string[][] };

const isTableRow = (line: string) => line.trim().startsWith("|") && line.trim().endsWith("|");

const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

function parse(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? "").startsWith("```")) {
        body.push(lines[i] ?? "");
        i += 1;
      }
      i += 1;
      blocks.push({ kind: "code", lang, text: body.join("\n") });
      continue;
    }

    if (/^##\s/.test(line)) {
      blocks.push({ kind: "heading", level: 2, text: line.slice(3).trim() });
      i += 1;
      continue;
    }

    if (line.trimStart().startsWith("> ")) {
      blocks.push({ kind: "quote", text: line.trimStart().slice(2).trim() });
      i += 1;
      continue;
    }

    if (isTableRow(line) && isTableRow(lines[i + 1] ?? "")) {
      const head = splitRow(line);
      const body: string[][] = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i] ?? "")) {
        body.push(splitRow(lines[i] ?? ""));
        i += 1;
      }
      blocks.push({ kind: "table", head, body });
      continue;
    }

    if (/^[-*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^[-*]\s/, ""));
        i += 1;
      }
      blocks.push({ kind: "list", ordered: false, items });
      continue;
    }

    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\d+\.\s/, ""));
        i += 1;
      }
      blocks.push({ kind: "list", ordered: true, items });
      continue;
    }

    const body: string[] = [];
    while (i < lines.length) {
      const current = lines[i] ?? "";
      if (current.trim() === "" || /^(#{2,3}\s|```|>\s?|[-*]\s|\d+\.\s)/.test(current.trimStart())) break;
      if (isTableRow(current)) break;
      body.push(current);
      i += 1;
    }
    blocks.push({ kind: "paragraph", text: body.join("\n") });
  }

  return blocks;
}

/** 行内：**粗体** 与 `代码` */
function inline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function MarkdownBase({ text }: { text: string }) {
  const blocks = parse(text);

  return (
    <div className="md">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "heading":
            return block.level === 2 ? (
              <h2 key={index}>{inline(block.text)}</h2>
            ) : (
              <h3 key={index}>{inline(block.text)}</h3>
            );
          case "paragraph":
            return <p key={index}>{inline(block.text)}</p>;
          case "list":
            return block.ordered ? (
              <ol key={index}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{inline(item)}</li>
                ))}
              </ol>
            ) : (
              <ul key={index}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{inline(item)}</li>
                ))}
              </ul>
            );
          case "quote":
            return <blockquote key={index}>{inline(block.text)}</blockquote>;
          case "code":
            return (
              <pre key={index} data-lang={block.lang}>
                <code>{block.text}</code>
              </pre>
            );
          case "table":
            return (
              <table key={index}>
                <thead>
                  <tr>
                    {block.head.map((cell, cellIndex) => (
                      <th key={cellIndex}>{inline(cell)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.body.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex}>{inline(cell)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

export const Markdown = memo(MarkdownBase);
