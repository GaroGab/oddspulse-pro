import React, { useEffect, useRef, useState } from 'react';

interface AnimatedNumberProps {
  value: number;
  formatter?: (val: number) => string;
  className?: string;
  durationMs?: number;
}

export const AnimatedNumber: React.FC<AnimatedNumberProps> = ({
  value,
  formatter = (v) => v.toFixed(2),
  className = '',
  durationMs = 420,
}) => {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);

  useEffect(() => {
    const startVal = prevRef.current;
    const endVal = value;
    if (Math.abs(endVal - startVal) < 0.0001) {
      setDisplay(endVal);
      return;
    }

    let raf = 0;
    const startTime = performance.now();

    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / durationMs);
      // Cubic ease-out
      const eased = 1 - Math.pow(1 - t, 3);
      const current = startVal + (endVal - startVal) * eased;
      setDisplay(current);
      if (t < 1) {
        raf = requestAnimationFrame(step);
      } else {
        prevRef.current = endVal;
        setDisplay(endVal);
      }
    };

    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      prevRef.current = endVal;
    };
  }, [value, durationMs]);

  return <span className={`tabular-nums ${className}`}>{formatter(display)}</span>;
};
