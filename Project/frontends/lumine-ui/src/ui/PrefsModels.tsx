import { useState, useSyncExternalStore } from "react";

import {
  enabledModelIds,
  getCatalog,
  newCustomId,
  removeProvider,
  setActiveProvider,
  subscribeProviders,
  upsertProvider,
  type ModelProvider,
} from "../core/providers";
import { PlusIcon } from "./icons";

const COLORS = ["#7c3aed", "#0e7490", "#b07a3c", "#0f766e", "#b0446a"];

export function PrefsModels() {
  const catalog = useSyncExternalStore(subscribeProviders, getCatalog, getCatalog);
  const providers = catalog.providers;
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-ui-13 font-medium text-ink">模型管理</h3>
          <p className="mt-0.5 text-ui-12 leading-relaxed text-ink-faint">
            按服务配置密钥与可用模型。右上角设置可快速切换当前服务商。
          </p>
        </div>
        <button
          type="button"
          className="flex shrink-0 items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-ui-13 text-on-accent"
          onClick={() => {
            setAdding(true);
            setEditing(null);
          }}
        >
          <PlusIcon size={14} />
          添加服务
        </button>
      </div>

      {adding ? (
        <ProviderEditor
          initial={emptyCustom()}
          onCancel={() => setAdding(false)}
          onSave={(provider) => {
            upsertProvider(provider);
            setAdding(false);
          }}
        />
      ) : null}

      <div className="flex flex-col gap-2">
        {providers.map((provider) => {
          const on = provider.models.filter((model) => model.enabled).length;
          const total = provider.models.length;
          const open = editing === provider.id;
          return (
            <div key={provider.id} className="rounded-xl border-[0.5px] border-border bg-canvas px-3 py-3">
              <div className="flex items-center gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ui-11 font-semibold text-on-accent" style={{ background: provider.color }}>
                  {provider.name.slice(0, 1)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-ui-13 font-medium text-ink">
                    {provider.name}
                    {provider.kind === "builtin" ? <span className="ml-1.5 text-ui-11 font-normal text-ink-faint">API Key</span> : null}
                  </p>
                  <p className="truncate text-ui-12 text-ink-faint">
                    {provider.kind === "builtin"
                      ? `已启用 ${on} / ${total} 个模型 · 密钥在「密钥」页`
                      : `${provider.apiKey ? "已填写密钥" : "未填写密钥"} · 已启用 ${on} / ${total} 个模型`}
                  </p>
                </div>
                <button
                  type="button"
                  className="rounded-lg border-[0.5px] border-border px-2.5 py-1 text-ui-13 text-ink-2 hover:bg-hover"
                  onClick={() => {
                    setAdding(false);
                    setEditing(open ? null : provider.id);
                  }}
                >
                  管理
                </button>
                {catalog.activeId === provider.id ? (
                  <span className="shrink-0 text-ui-12 font-medium text-accent">当前</span>
                ) : (
                  <button
                    type="button"
                    className="rounded-lg border-[0.5px] border-border px-2.5 py-1 text-ui-13 text-ink-2 hover:bg-hover"
                    onClick={() => setActiveProvider(provider.id)}
                  >
                    使用
                  </button>
                )}
              </div>
              {open ? (
                <div className="mt-3 border-t-[0.5px] border-border pt-3">
                  <ProviderEditor
                    initial={provider}
                    onCancel={() => setEditing(null)}
                    onSave={(next) => {
                      upsertProvider(next);
                      setEditing(null);
                    }}
                    {...(provider.kind === "custom"
                      ? {
                          onDelete: () => {
                            removeProvider(provider.id);
                            setEditing(null);
                          },
                        }
                      : {})}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className="text-ui-12 text-ink-faint">
        当前输入卡可选：{enabledModelIds().join("、") || "无（请至少启用一个模型）"}。自定义 Base URL 会写入本机配置；真正改走该地址还要后端接上。
      </p>
    </div>
  );
}

function emptyCustom(): ModelProvider {
  return {
    id: newCustomId(),
    name: "",
    kind: "custom",
    baseUrl: "https://api.openai.com/v1",
    color: COLORS[1] ?? "#0e7490",
    enabled: true,
    models: [{ id: "", enabled: true }],
    apiKey: "",
  };
}

function ProviderEditor({
  initial,
  onSave,
  onCancel,
  onDelete,
}: {
  initial: ModelProvider;
  onSave: (provider: ModelProvider) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [apiKey, setApiKey] = useState(initial.apiKey ?? "");
  const [color, setColor] = useState(initial.color);
  const [modelText, setModelText] = useState(initial.models.map((model) => model.id).join(", "));
  const builtin = initial.kind === "builtin";

  return (
    <div className="flex flex-col gap-2.5">
      <label className="flex flex-col gap-1 text-ui-12 text-ink-dim">
        名称
        <input
          value={name}
          disabled={builtin}
          onChange={(event) => setName(event.target.value)}
          className="h-8 rounded-lg border-[0.5px] border-border bg-surface px-2 text-ui-13 text-ink outline-none disabled:text-ink-faint"
        />
      </label>
      <label className="flex flex-col gap-1 text-ui-12 text-ink-dim">
        Base URL
        <input
          value={baseUrl}
          disabled={builtin}
          onChange={(event) => setBaseUrl(event.target.value)}
          className="h-8 rounded-lg border-[0.5px] border-border bg-surface px-2 text-ui-13 text-ink outline-none disabled:text-ink-faint"
        />
      </label>
      {builtin ? (
        <p className="text-ui-12 text-ink-faint">内置 DeepSeek 的密钥请到左侧「密钥」保存，避免两处打架。</p>
      ) : (
        <label className="flex flex-col gap-1 text-ui-12 text-ink-dim">
          API Key
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="只存在这台电脑"
            className="h-8 rounded-lg border-[0.5px] border-border bg-surface px-2 text-ui-13 text-ink outline-none"
          />
        </label>
      )}
      <label className="flex flex-col gap-1 text-ui-12 text-ink-dim">
        模型 ID（逗号分隔）
        <input
          value={modelText}
          disabled={builtin}
          onChange={(event) => setModelText(event.target.value)}
          placeholder="deepseek-chat, deepseek-reasoner"
          className="h-8 rounded-lg border-[0.5px] border-border bg-surface px-2 text-ui-13 text-ink outline-none disabled:text-ink-faint"
        />
      </label>
      <div className="flex flex-wrap gap-1.5">
        {initial.models.map((model) => (
          <label key={model.id} className="flex items-center gap-1.5 text-ui-12 text-ink-2">
            <input
              type="checkbox"
              checked={model.enabled}
              onChange={(event) => {
                upsertProvider({
                  ...initial,
                  models: initial.models.map((item) =>
                    item.id === model.id ? { ...item, enabled: event.target.checked } : item,
                  ),
                });
              }}
            />
            {model.id}
          </label>
        ))}
      </div>
      <div className="flex gap-1.5">
        {COLORS.map((item) => (
          <button
            key={item}
            type="button"
            aria-label={`颜色 ${item}`}
            className={`h-5 w-5 rounded-full border ${color === item ? "border-ink" : "border-transparent"}`}
            style={{ background: item }}
            onClick={() => setColor(item)}
          />
        ))}
      </div>
      <div className="flex justify-end gap-1.5">
        {onDelete ? (
          <button type="button" className="mr-auto text-ui-13 text-err hover:underline" onClick={onDelete}>
            删除服务
          </button>
        ) : null}
        <button type="button" className="rounded-lg px-2.5 py-1.5 text-ui-13 text-ink-dim hover:bg-hover" onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          className="rounded-lg bg-accent px-2.5 py-1.5 text-ui-13 text-on-accent disabled:opacity-40"
          disabled={!builtin && (name.trim() === "" || parseModels(modelText).length === 0)}
          onClick={() => {
            const models = builtin
              ? initial.models
              : parseModels(modelText).map((id) => ({
                  id,
                  enabled: initial.models.find((item) => item.id === id)?.enabled !== false,
                }));
            onSave({
              ...initial,
              name: name.trim() || initial.name,
              baseUrl: baseUrl.trim(),
              color,
              models,
              ...(builtin ? {} : { apiKey }),
            });
          }}
        >
          保存
        </button>
      </div>
    </div>
  );
}

function parseModels(text: string): string[] {
  return text
    .split(/[,，\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}
