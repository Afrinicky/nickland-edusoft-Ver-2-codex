// Nickland Edusoft — access-level pill selector.
//
// One segmented control for the whole permission model: No access · View ·
// Contribute · Manage · Full. Levels build left-to-right, so the control reads
// as "how far along the ladder is this person for this area". When `allowInherit`
// is set, a leading "Same as role" segment clears any individual override.
import React from 'react';

export default function LevelPills({
  levels,            // catalogue: [{ key, label, short, description }]
  value,             // current level key, or 'inherit'
  onChange,
  disabled = false,
  allowInherit = false,
  inheritLabel = 'Same as role',
  size = 'md',
}) {
  const options = allowInherit
    ? [{ key: 'inherit', label: inheritLabel, description: 'Use whatever this person’s role allows.' }, ...levels]
    : levels;

  return (
    <div className={'level-pills' + (size === 'sm' ? ' level-pills-sm' : '') + (disabled ? ' is-disabled' : '')}
      role="radiogroup">
      {options.map(opt => {
        const active = value === opt.key || (allowInherit && value == null && opt.key === 'inherit');
        return (
          <button
            key={opt.key}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            title={opt.description || ''}
            className={'level-pill' + (active ? ' active' : '') + (opt.key === 'no' ? ' level-pill-none' : '')}
            onClick={() => !disabled && onChange(opt.key)}
          >
            {opt.short || opt.label}
          </button>
        );
      })}
    </div>
  );
}
