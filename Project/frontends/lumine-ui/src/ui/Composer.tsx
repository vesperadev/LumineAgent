import { useEffect, useState } from "react";
import { useRef } from "react";

import type { Chat } from "../core/hooks";
import { useComposer } from "../core/hooks";
import { ArrowUpIcon, CheckIcon, ChevronDownIcon, PlusIcon, ShieldIcon, StopIcon } from "./icons";
import { Menu, MenuItem } from "./Menu";

type Permission = "default" | "full";

const PERMISSIONS: { id: Permission; name: string; hint: string }[] = [
  { id: "default", name: "默认", hint: "按权限规则审批高危操作" },
  { id: "full", name: "完全访问", hint: "不拦截任何操作，高危命令执行留痕审计；仅当前会话生效" },
];

/**
 * 输入卡：20px 圆角 / 0.5px 描边 / shadow-soft（Percho 的 Composer 几何）。
 * 从左到右：附件 + 权限胶囊 … 模型胶囊 + 32px 黑圆发送键。
 */
export function Composer({ chat, centered = false }: { chat: Chat; centered?: boolean }) {
  const composer = useComposer(chat);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const [permission, setPermission] = useState<Permission>("default");
  const focusOnMount = centered;

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`;
  }, [composer.text]);

  useEffect(() => {
    if (focusOnMount) areaRef.current?.focus();
  }, [focusOnMount]);

  const currentPermission = PERMISSIONS.find((item) => item.id === permission) ?? PERMISSIONS[0];

  return (
    <div className={centered ? "w-full max-w-[800px]" : "shrink-0 px-6 pb-3"}>
      <div className={centered ? "relative mx-auto max-w-[800px]" : "relative mx-auto max-w-[760px]"}>
        <div className="rounded-[20px] border-[0.5px] border-border bg-surface shadow-soft">
          <div className="px-4 pt-2 pb-5.5">
            <textarea
              ref={areaRef}
              value={composer.text}
              placeholder="随便问点什么，/ 命令，@ 上下文"
              onChange={(event) => composer.setText(event.target.value)}
              onKeyDown={composer.onKeyDown}
              spellCheck={false}
              rows={1}
              className="w-full resize-none bg-transparent text-ui-15 leading-[1.7] text-ink outline-none placeholder:text-ink-faint"
            />
          </div>
          <div className="flex items-center gap-2 px-3 pb-2">
            <button
              type="button"
              className="-ml-1 flex h-7 w-7 items-center justify-center rounded-lg text-ink-dim transition-colors hover:bg-hover hover:text-ink"
              aria-label="添加图片"
              title="添加附件"
            >
              <PlusIcon size={18} />
            </button>

            <Menu
              align="left"
              trigger={({ toggle }) => (
                <button
                  type="button"
                  onClick={toggle}
                  className="flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-ui-14 leading-[calc(1_/_0.75)] text-ink-dim transition-colors hover:bg-hover hover:text-ink"
                  aria-label="权限模式"
                >
                  <ShieldIcon size={14} />
                  <span>{currentPermission?.name}</span>
                  <ChevronDownIcon />
                </button>
              )}
            >
              {({ close }) => (
                <div className="flex flex-col gap-px">
                  {PERMISSIONS.map((item) => (
                    <MenuItem
                      key={item.id}
                      label={item.name}
                      hint={item.hint}
                      active={item.id === permission}
                      onClick={() => {
                        setPermission(item.id);
                        close();
                      }}
                    />
                  ))}
                </div>
              )}
            </Menu>

            <div className="flex-1" />
            {chat.streaming ? <span className="spinner-ring" aria-hidden="true" /> : null}

            <Menu
              align="right"
              trigger={({ toggle }) => (
                <button
                  type="button"
                  onClick={toggle}
                  className="flex max-w-[208px] items-center gap-1 rounded-full px-2.5 py-1 text-ui-14 leading-[calc(1_/_0.75)] text-ink-dim transition-colors hover:bg-hover hover:text-ink"
                  aria-label="选择模型"
                >
                  <span className="truncate">{chat.model}</span>
                  <span className="shrink-0 text-ink-faint">·</span>
                  <span className="shrink-0 text-ink-faint">低</span>
                  <ChevronDownIcon />
                </button>
              )}
            >
              {({ close }) => (
                <div className="flex flex-col gap-px">
                  {chat.models.map((model) => (
                    <MenuItem
                      key={model}
                      label={model}
                      hint={model.includes("reasoner") ? "推理模型：更慢，但会展示思考过程" : "通用对话模型"}
                      active={model === chat.model}
                      onClick={() => {
                        chat.setModel(model);
                        close();
                      }}
                    />
                  ))}
                  <p className="px-2.5 py-1.5 text-ui-11 text-ink-faint">思考深度与真实模型清单待后端提供</p>
                </div>
              )}
            </Menu>

            {chat.streaming ? (
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-on-ink transition-colors hover:bg-err"
                onClick={composer.stop}
                aria-label="停止"
              >
                <StopIcon size={12} />
              </button>
            ) : (
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-on-ink transition-colors hover:bg-ink-2 disabled:opacity-30"
                disabled={!composer.canSend}
                onClick={composer.submit}
                aria-label="发送"
              >
                <ArrowUpIcon size={20} />
              </button>
            )}
          </div>
        </div>

        {chat.streaming ? (
          <p className="mt-1.5 flex items-center justify-center gap-1 text-ui-11 text-ink-faint">
            <CheckIcon size={10} />
            生成中 · Esc 可中断
          </p>
        ) : null}
      </div>
    </div>
  );
}
