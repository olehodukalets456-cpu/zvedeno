"use client";

import { useMemo, useState } from "react";

export type AnalyticsGroupOption = {
  value: string;
  label: string;
};

export type AnalyticsDatePreset = {
  value: string;
  label: string;
  from: string;
  to: string;
};

type GroupingBuilderProps = {
  options: AnalyticsGroupOption[];
  initialGroups: string[];
};

type DateRangePickerProps = {
  presets: AnalyticsDatePreset[];
  initialPreset: string;
  initialFrom: string;
  initialTo: string;
};

export function GroupingBuilder({ options, initialGroups }: GroupingBuilderProps) {
  const allowedValues = useMemo(() => new Set(options.map((option) => option.value)), [options]);
  const [groups, setGroups] = useState(() => (
    initialGroups.filter((value, index, values) => allowedValues.has(value) && values.indexOf(value) === index)
  ));

  const unusedOptions = options.filter((option) => !groups.includes(option.value));

  function addGroup(value: string) {
    if (!value || groups.includes(value) || !allowedValues.has(value)) return;
    setGroups((current) => [...current, value]);
  }

  function replaceGroup(index: number, value: string) {
    if (!allowedValues.has(value)) return;

    setGroups((current) => {
      const duplicateIndex = current.indexOf(value);
      const next = [...current];

      if (duplicateIndex !== -1 && duplicateIndex !== index) {
        const currentValue = next[index];
        const duplicateValue = next[duplicateIndex];
        if (currentValue === undefined || duplicateValue === undefined) return current;
        next[index] = duplicateValue;
        next[duplicateIndex] = currentValue;
        return next;
      }

      if (next[index] === undefined) return current;
      next[index] = value;
      return next;
    });
  }

  function removeGroup(index: number) {
    setGroups((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  function moveGroup(index: number, direction: -1 | 1) {
    setGroups((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const currentValue = current[index];
      const targetValue = current[target];
      if (currentValue === undefined || targetValue === undefined) return current;
      const next = [...current];
      next[index] = targetValue;
      next[target] = currentValue;
      return next;
    });
  }

  return (
    <div className="trackerGroupingBuilder">
      <span className="trackerGroupingLabel">Групування</span>

      <div className="trackerGroupingSequence">
        {groups.map((group, index) => (
          <div className="trackerGroupingChip" key={`${group}-${index}`}>
            <button
              aria-label="Перемістити групування ліворуч"
              className="trackerGroupingMove"
              disabled={index === 0}
              onClick={() => moveGroup(index, -1)}
              type="button"
            >
              ‹
            </button>
            <select
              aria-label={`Групування ${index + 1}`}
              onChange={(event) => replaceGroup(index, event.target.value)}
              value={group}
            >
              {options.map((option) => (
                <option value={option.value} key={option.value}>{option.label}</option>
              ))}
            </select>
            <button
              aria-label="Перемістити групування праворуч"
              className="trackerGroupingMove"
              disabled={index === groups.length - 1}
              onClick={() => moveGroup(index, 1)}
              type="button"
            >
              ›
            </button>
            <button
              aria-label="Прибрати групування"
              className="trackerGroupingRemove"
              onClick={() => removeGroup(index)}
              type="button"
            >
              ×
            </button>
          </div>
        ))}

        {unusedOptions.length > 0 && (
          <select
            aria-label="Додати групування"
            className="trackerGroupingAdd"
            onChange={(event) => {
              addGroup(event.target.value);
              event.target.value = "";
            }}
            value=""
          >
            <option value="">+ Групування</option>
            {unusedOptions.map((option) => (
              <option value={option.value} key={option.value}>{option.label}</option>
            ))}
          </select>
        )}

        {groups.length === 0 && <span className="trackerGroupingEmpty">Буде показано лише total</span>}
      </div>

      {options.map((_, index) => (
        <input name={`group${index + 1}`} type="hidden" value={groups[index] ?? ""} key={index} />
      ))}
    </div>
  );
}

export function DateRangePicker({
  presets,
  initialPreset,
  initialFrom,
  initialTo
}: DateRangePickerProps) {
  const [preset, setPreset] = useState(initialPreset);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);

  function selectPreset(value: string) {
    setPreset(value);
    const selected = presets.find((item) => item.value === value);
    if (!selected || value === "custom") return;
    setFrom(selected.from);
    setTo(selected.to);
  }

  return (
    <>
      <label className="trackerField trackerRangePreset">
        <span>Період</span>
        <select name="range" onChange={(event) => selectPreset(event.target.value)} value={preset}>
          {presets.map((item) => (
            <option value={item.value} key={item.value}>{item.label}</option>
          ))}
        </select>
      </label>

      <label className="trackerField trackerDate">
        <span>Від</span>
        <input
          name="from"
          onChange={(event) => {
            setFrom(event.target.value);
            setPreset("custom");
          }}
          type="date"
          value={from}
        />
      </label>

      <label className="trackerField trackerDate">
        <span>До</span>
        <input
          name="to"
          onChange={(event) => {
            setTo(event.target.value);
            setPreset("custom");
          }}
          type="date"
          value={to}
        />
      </label>
    </>
  );
}
