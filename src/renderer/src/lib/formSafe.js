// Nickland Edusoft — Form input safety helpers
// Eliminates the controlled/uncontrolled React bug that freezes inputs.
//
// Root cause: when DB returns null for an empty field and that null is fed to
// <input value={x} />, React treats the input as uncontrolled. When the user
// then types into it, React tries to switch it to controlled, but the value
// state may have stale references and the input appears to freeze.
//
// Fix: always coerce to empty string for text inputs, 0 for numbers,
// before storing in React state.

/**
 * Sanitize an object loaded from the database so it is safe to pass to useState.
 * - null/undefined → '' (for text fields)
 * - Use this on every DB row before using it as form state.
 */
export function sanitizeForForm(obj) {
  if (!obj) return {};
  const out = {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    out[k] = (v === null || v === undefined) ? '' : v;
  }
  return out;
}

/**
 * Wrap a setForm callback so it always merges safely (preserves all fields).
 */
export function safeSet(setForm, field, value) {
  setForm(prev => ({ ...prev, [field]: value === null || value === undefined ? '' : value }));
}

/**
 * For numeric inputs — coerce to a string representation that's safe for
 * <input type="number" value={...} />. Returns '' for null/undefined/NaN.
 */
export function numberVal(v) {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? String(v) : '';
}

/**
 * For text inputs — coerce to a non-null string.
 */
export function textVal(v) {
  return (v === null || v === undefined) ? '' : String(v);
}

/**
 * Build initial state for a form, given an optional existing record and a list
 * of expected field names with their defaults.
 *
 * Usage:
 *   const [data, setData] = useState(initForm(student, {
 *     surname: '', first_name: '', age: '', date_of_birth: '',
 *   }));
 */
export function initForm(record, defaults) {
  const out = { ...defaults };
  if (record) {
    for (const k of Object.keys(defaults)) {
      const v = record[k];
      out[k] = (v === null || v === undefined) ? defaults[k] : v;
    }
    // Preserve the id and any other fields not in defaults
    if (record.id !== undefined) out.id = record.id;
  }
  return out;
}
