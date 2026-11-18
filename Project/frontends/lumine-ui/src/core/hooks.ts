import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { getUiSettings } from "../theme/store";
import { engine, isMock } from "./engine";
import type { ChatState, Metrics, SendResult } from "./types";

export interface Chat extends ChatState {
  send: (text: string) => Promise<SendResult>;
  stop: () => void;
  reset: () => Promise<void>;
  setModel: (model: string) => void;
  setPermission: (permission: ChatState["permission"]) => void;
  decideApproval: (allow: boolean) => Promise<void>;
  openSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  attachPaths: (paths: string[]) => void;
  streaming: boolean;
  metrics: Metrics;
  mock: boolean;
}

/**
 * 订阅外部 store：整个列表只在一帧内更新一次，
 * 逐 token 刷新由 requestAnimationFrame 批量合并。
 */
export function useChat(): Chat {
  useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
  const state = engine.getState();

  return {
    ...state,
    send: engine.send,
    stop: engine.stop,
    reset: engine.reset,
    setModel: engine.setModel,
    setPermission: engine.setPermission,
    decideApproval: engine.decideApproval,
    openSession: engine.openSession,
    deleteSession: engine.deleteSession,
    attachPaths: engine.attachPaths,
    streaming: state.phase === "streaming",
    metrics: engine.metrics,
    mock: isMock(),
  };
}

/**
 * 粘贴到底部才跟随：用户手动上滚阅读时不打断。
 * 十种风格都用这个，避免各自写一份不同的滚动策略。
 */
export function useAutoScroll(dependency: unknown, count = 0) {
  const ref = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);
  const lastCount = useRef(count);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 新消息追加时重新贴底：用户上滚是在读旧内容，但自己发的新消息必须落在视口里
    if (count > lastCount.current) stick.current = true;
    lastCount.current = count;
    if (stick.current) el.scrollTop = el.scrollHeight;
  }, [dependency, count]);

  return { ref, onScroll };
}

export interface Composer {
  text: string;
  setText: (value: string) => void;
  submit: () => void;
  stop: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  canSend: boolean;
}

/**
 * 输入行为只在 hook 里实现一次：Enter 发送、Shift+Enter 换行、Esc 中断。
 * 十种风格只负责画界面，行为契约保持一致，否则对比没有意义。
 */
export function useComposer(chat: Chat): Composer {
  const [text, setText] = useState("");
  const restored = useRef<string | null>(null);

  // 请求失败时把用户原话回填，避免重打
  useEffect(() => {
    if (chat.retryText && restored.current !== chat.retryText && text === "") {
      restored.current = chat.retryText;
      setText(chat.retryText);
    }
  }, [chat.retryText, text]);

  const submit = useCallback(() => {
    const value = text.trim();
    if (!value || chat.streaming) return;
    setText("");
    void chat.send(value).then((result) => {
      if (!result.ok) setText(value);
    });
  }, [chat, text]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        chat.stop();
        return;
      }
      const enterToSend = getUiSettings().enterToSend;
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Enter" && enterToSend && !event.shiftKey) {
        event.preventDefault();
        submit();
        return;
      }
      if (event.key === "Enter" && !enterToSend && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        submit();
      }
    },
    [chat, submit],
  );

  return {
    text,
    setText,
    submit,
    stop: chat.stop,
    onKeyDown,
    canSend: text.trim().length > 0 && !chat.streaming,
  };
}
