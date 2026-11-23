import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

interface PillRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface SlidingPillTrackProps {
  /** Key matching the active child element's `data-pill-key` attribute */
  activeKey: string;
  /** Tailwind classes styling the sliding pill (background, border, radius, shadow) */
  pillClassName: string;
  /** Container layout classes (`relative` is always enforced) */
  className?: string;
  /** Optional dependency value to trigger re-measurement when dynamic labels/badges resize */
  measureDep?: string | number;
  children: React.ReactNode;
}

/**
 * Pure GPU-composited sliding pill track for horizontal/grid segmented controls.
 *
 * Uses local layout offsets (`offsetLeft/Top/Width/Height`) + CSS `translate3d` transitions
 * instead of Framer Motion `layoutId` (`MeasureLayout`), avoiding the `framer-motion@11.15`
 * `usePresence` registration leak that deadlocks ancestor `<AnimatePresence>` containers.
 */
export const SlidingPillTrack: React.FC<SlidingPillTrackProps> = ({
  activeKey,
  pillClassName,
  className = '',
  measureDep,
  children,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeKeyRef = useRef<string>(activeKey);
  activeKeyRef.current = activeKey;

  const [rect, setRect] = useState<PillRect | null>(null);
  const [canAnimate, setCanAnimate] = useState(false);

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const targetKey = activeKeyRef.current;
    let target: HTMLElement | null = null;
    const kids = container.children;
    for (let i = 0; i < kids.length; i++) {
      const el = kids[i] as HTMLElement;
      if (el.getAttribute('data-pill-key') === targetKey) {
        target = el;
        break;
      }
    }

    if (!target) {
      setRect(null);
      return;
    }

    const next: PillRect = {
      left: target.offsetLeft,
      top: target.offsetTop,
      width: target.offsetWidth,
      height: target.offsetHeight,
    };

    if (next.width === 0 && next.height === 0) return;

    setRect((prev) => {
      if (
        prev &&
        prev.left === next.left &&
        prev.top === next.top &&
        prev.width === next.width &&
        prev.height === next.height
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  // Measure synchronously before paint whenever activeKey or dynamic label counts change
  useLayoutEffect(() => {
    measure();
  }, [activeKey, measureDep, measure]);

  // Enable CSS sliding transition only after initial position has painted (prevents mount fly-in)
  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        setCanAnimate(true);
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, []);

  // Re-measure cleanly on container or option resize without disrupting transitions
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;

    const ro = new ResizeObserver(() => {
      measure();
    });
    ro.observe(container);
    for (let i = 0; i < container.children.length; i++) {
      const child = container.children[i];
      if (child instanceof HTMLElement && child.hasAttribute('data-pill-key')) {
        ro.observe(child);
      }
    }
    return () => ro.disconnect();
  }, [measure, measureDep]);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {rect && (
        <span
          aria-hidden="true"
          data-testid="sliding-pill-indicator"
          style={{
            transform: `translate3d(${rect.left}px, ${rect.top}px, 0)`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
          }}
          className={`pointer-events-none absolute left-0 top-0 z-0 ${
            canAnimate ? 'sliding-pill-indicator' : ''
          } ${pillClassName}`}
        />
      )}
      {children}
    </div>
  );
};
