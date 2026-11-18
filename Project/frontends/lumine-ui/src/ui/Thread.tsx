import { useMemo, useState } from "react";

import { useAutoScroll } from "../core/hooks";
import type { Chat } from "../core/hooks";
import { MessageBlock } from "./MessageBlock";

const WINDOW = 200;

/** 消息列：超过 200 条时只挂载窗口，避免长会话卡顿 */
export function Thread({ chat }: { chat: Chat; title?: string }) {
  const [showAll, setShowAll] = useState(false);
  const hidden = !showAll && chat.messages.length > WINDOW ? chat.messages.length - WINDOW : 0;
  const visible = useMemo(
    () => (hidden > 0 ? chat.messages.slice(hidden) : chat.messages),
    [chat.messages, hidden],
  );
  const { ref, onScroll } = useAutoScroll(chat.messages, chat.messages.length);

  return (
    <div ref={ref} onScroll={onScroll} className="h-full overflow-y-auto" data-session-page="">
      <div className="mx-auto flex max-w-[760px] flex-col gap-6 px-6 pt-8 pb-16">
        {hidden > 0 ? (
          <button
            type="button"
            className="self-center text-ui-12 text-ink-faint hover:text-ink-2"
            onClick={() => setShowAll(true)}
          >
            更早的 {hidden} 条已折叠，点击展开
          </button>
        ) : null}
        {visible.map((message) => (
          <MessageBlock key={message.id} message={message} />
        ))}
      </div>
    </div>
  );
}
