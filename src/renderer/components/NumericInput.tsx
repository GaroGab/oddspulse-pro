import React, { useEffect, useRef, useState } from 'react';

interface NumericInputProps {
  id?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  allowDecimal?: boolean;
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
  'data-testid'?: string;
}

/**
 * Clean controlled decimal/integer input that:
 * - Never leaves stuck leading zeros ("0100" -> "100")
 * - Allows clearing the field completely while typing without snapping back to "0"
 * - Accepts both "." and "," decimal separators (Italian keyboard friendly)
 * - Removes ugly browser white number-spinner arrows
 */
export const NumericInput: React.FC<NumericInputProps> = ({
  id,
  value,
  onChange,
  min = 0,
  max,
  allowDecimal = true,
  placeholder = '0',
  className = '',
  'aria-label': ariaLabel,
  'data-testid': dataTestId,
}) => {
  const [text, setText] = useState<string>(() => (Number.isFinite(value) ? String(value) : ''));
  const lastEmittedRef = useRef<number>(value);

  // Sync only when `value` changed externally (e.g. preset button or switching match),
  // never overriding what the user just typed (including clearing to "").
  useEffect(() => {
    if (Object.is(value, lastEmittedRef.current) || Math.abs(value - lastEmittedRef.current) < 1e-9) {
      return;
    }
    lastEmittedRef.current = value;
    setText(Number.isFinite(value) ? String(value) : '');
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let raw = e.target.value.replace(',', '.');

    // Allow only digits and (optionally) a single decimal point
    if (allowDecimal) {
      raw = raw.replace(/[^0-9.]/g, '');
      const firstDot = raw.indexOf('.');
      if (firstDot !== -1) {
        raw = raw.slice(0, firstDot + 1) + raw.slice(firstDot + 1).replace(/\./g, '');
      }
    } else {
      raw = raw.replace(/[^0-9]/g, '');
    }

    // Strip redundant leading zeros: "0100" -> "100", "00" -> "0", keep "0." intact
    if (/^0\d/.test(raw)) {
      raw = raw.replace(/^0+(?=\d)/, '');
    }

    setText(raw);

    if (raw === '' || raw === '.') {
      lastEmittedRef.current = 0;
      onChange(0);
      return;
    }

    const num = parseFloat(raw);
    if (Number.isFinite(num)) {
      let clamped = num;
      if (max !== undefined && clamped > max) clamped = max;
      lastEmittedRef.current = clamped;
      onChange(clamped);
    }
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    // Select all on focus if value is "0" so typing immediately replaces it
    if (text === '0') {
      e.currentTarget.select();
    }
  };

  const handleBlur = () => {
    const num = parseFloat(text.replace(',', '.'));
    if (!Number.isFinite(num)) {
      const fallback = min;
      lastEmittedRef.current = fallback;
      setText(String(fallback));
      onChange(fallback);
      return;
    }
    let clamped = Math.max(min, num);
    if (max !== undefined) clamped = Math.min(max, clamped);
    lastEmittedRef.current = clamped;
    setText(String(clamped));
    onChange(clamped);
  };

  return (
    <input
      id={id}
      type="text"
      inputMode={allowDecimal ? 'decimal' : 'numeric'}
      value={text}
      placeholder={placeholder}
      aria-label={ariaLabel}
      data-testid={dataTestId}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      className={className}
    />
  );
};
