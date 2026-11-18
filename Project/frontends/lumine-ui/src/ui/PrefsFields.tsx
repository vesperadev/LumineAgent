import type { ReactNode } from "react";

/** 设置页行：左文案、右控件。几何用现有 token，不改 Percho 基线。 */
export function SettingGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="mb-1.5 px-0.5 text-ui-12 font-medium text-ink-faint">{title}</h3>
      <div className="overflow-hidden rounded-xl border-[0.5px] border-border bg-canvas px-3">{children}</div>
    </section>
  );
}

export function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 border-b-[0.5px] border-border py-3 last:border-b-0 min-[560px]:grid-cols-[minmax(0,1fr)_minmax(9rem,16rem)] min-[560px]:items-center min-[560px]:gap-6">
      <div className="min-w-0">
        <p className="text-ui-13 font-medium text-ink">{label}</p>
        {description ? <p className="mt-0.5 text-ui-12 leading-relaxed text-ink-faint">{description}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function ChoiceBar<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={`rounded-lg border-[0.5px] px-2 py-1.5 text-ui-13 ${
            value === option.id ? "border-accent bg-accent-soft text-ink" : "border-border text-ink-dim"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${on ? "bg-accent" : "bg-hover"}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow-soft transition-[left] ${
          on ? "left-[18px]" : "left-0.5"
        }`}
      />
    </button>
  );
}
