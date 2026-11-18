/** 本机模型服务目录。只存配置，不照搬任何上游设置页。 */

export type ProviderKind = "builtin" | "custom";

export type ProviderModel = {
  id: string;
  enabled: boolean;
};

export type ModelProvider = {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  color: string;
  enabled: boolean;
  models: ProviderModel[];
  /** 自定义服务的密钥只留在本机 localStorage；内置 DeepSeek 走 secrets.env */
  apiKey?: string;
};

export type Catalog = {
  activeId: string;
  providers: ModelProvider[];
};

const STORAGE_KEY = "lumine.providers.v1";

const DEEPSEEK: ModelProvider = {
  id: "deepseek",
  name: "DeepSeek",
  kind: "builtin",
  baseUrl: "https://api.deepseek.com/v1",
  color: "#7c3aed",
  enabled: true,
  models: [
    { id: "deepseek-chat", enabled: true },
    { id: "deepseek-reasoner", enabled: true },
  ],
};

function cloneDeepseek(): ModelProvider {
  return {
    ...DEEPSEEK,
    models: DEEPSEEK.models.map((model) => ({ ...model })),
  };
}

function normalize(list: ModelProvider[]): ModelProvider[] {
  const rest = list.filter((item) => item.id !== "deepseek");
  const saved = list.find((item) => item.id === "deepseek");
  const deepseek = cloneDeepseek();
  if (saved) {
    deepseek.enabled = saved.enabled !== false;
    deepseek.color = saved.color || deepseek.color;
    deepseek.models = deepseek.models.map((model) => ({
      ...model,
      enabled: saved.models.find((item) => item.id === model.id)?.enabled !== false,
    }));
  }
  return [deepseek, ...rest.filter((item) => item.kind === "custom" && item.models.length > 0)];
}

function read(): Catalog {
  const fallback: Catalog = { activeId: "deepseek", providers: normalize([cloneDeepseek()]) };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Catalog | ModelProvider[];
    if (Array.isArray(parsed)) {
      const providers = normalize(parsed);
      const active = providers.find((item) => item.enabled)?.id ?? "deepseek";
      return { activeId: active, providers };
    }
    if (!parsed || !Array.isArray(parsed.providers)) return fallback;
    const providers = normalize(parsed.providers);
    const activeId = providers.some((item) => item.id === parsed.activeId) ? parsed.activeId : "deepseek";
    return { activeId, providers };
  } catch {
    return fallback;
  }
}

let catalog: Catalog = typeof localStorage === "undefined" ? { activeId: "deepseek", providers: [cloneDeepseek()] } : read();
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(catalog));
  } catch {
    /* 隐私模式写失败不影响本次会话 */
  }
  for (const listener of listeners) listener();
}

export function subscribeProviders(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCatalog(): Catalog {
  return catalog;
}

export function getProviders(): ModelProvider[] {
  return catalog.providers;
}

export function getActiveProviderId(): string {
  return catalog.activeId;
}

export function getActiveProvider(): ModelProvider | undefined {
  return catalog.providers.find((item) => item.id === catalog.activeId) ?? catalog.providers[0];
}

export function setActiveProvider(id: string) {
  if (!catalog.providers.some((item) => item.id === id)) return;
  if (catalog.activeId === id) return;
  catalog = { ...catalog, activeId: id };
  persist();
}

export function enabledModelIds(): string[] {
  const provider = getActiveProvider();
  if (!provider) return [];
  return provider.models.filter((model) => model.enabled).map((model) => model.id);
}

export function upsertProvider(next: ModelProvider) {
  const index = catalog.providers.findIndex((item) => item.id === next.id);
  const providers =
    index >= 0
      ? catalog.providers.map((item, i) => (i === index ? next : item))
      : [...catalog.providers, next];
  catalog = {
    providers,
    activeId: index >= 0 ? catalog.activeId : next.id,
  };
  persist();
}

export function removeProvider(id: string) {
  if (id === "deepseek") return;
  const providers = catalog.providers.filter((item) => item.id !== id);
  catalog = {
    providers,
    activeId: catalog.activeId === id ? "deepseek" : catalog.activeId,
  };
  persist();
}

export function newCustomId(): string {
  return `custom-${Date.now().toString(36)}`;
}
