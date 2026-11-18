import { useAutoScroll } from "../core/hooks";
import type { Chat } from "../core/hooks";
import { MessageBlock } from "./MessageBlock";

/** 消息列：760px 居中、24px 行距、上 32 / 下 64（Percho 的 MessageList 几何） */
export function Thread({ chat }: { chat: Chat; title?: string }) {
  const { ref, onScroll } = useAutoScroll(chat.messages, chat.messages.length);

  return (
    <div ref={ref} onScroll={onScroll} className="h-full overflow-y-auto" data-session-page="">
      <div className="mx-auto flex max-w-[760px] flex-col gap-6 px-6 pt-8 pb-16">
        {chat.messages.map((message) => (
          <MessageBlock key={message.id} message={message} />
        ))}
      </div>
    </div>
  );
}
