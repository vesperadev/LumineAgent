import type { Chat } from "../core/hooks";
import { Composer } from "./Composer";

/** 空态：大字号品牌 + slogan + 居中输入卡 + 项目/分支行（Percho 的 EmptyState） */
export function EmptyState({ chat }: { chat: Chat }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 px-8 pb-[8vh]">
      <div className="flex min-h-20 w-full max-w-[760px] items-center justify-center min-[721px]:mb-2 min-[721px]:min-h-24">
        <h1 className="text-center text-ui-28 font-normal leading-[1.4] tracking-[-0.015em] text-ink min-[721px]:text-ui-32">
          <span className="mr-3 inline-block text-ui-36 font-medium text-ink-faint min-[721px]:text-ui-40">
            Lumine
          </span>
          做你所想，如你所愿
        </h1>
      </div>

      <Composer chat={chat} centered />

      <div className="flex items-center justify-center gap-2 text-ui-13 text-ink-dim">
        <button type="button" className="flex items-center gap-1.5 hover:text-ink">
          LumineAgent
        </button>
        <span className="text-border-strong">/</span>
        <button type="button" className="flex items-center gap-1.5 hover:text-ink">
          <span aria-hidden="true">⎇</span>
          main
        </button>
      </div>
    </div>
  );
}
