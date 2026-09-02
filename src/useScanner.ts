// Global scan capture layer. See
// docs/superpowers/specs/2026-09-02-scanner-support-design.md section 3.
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { notifications } from '@mantine/notifications';
import { useAppStore } from './store';
import { classify, type Scan } from './scan.ts';

/** Mount ONCE, in AppLayout. Attaches a capture-phase window keydown listener
 *  that buffers a scanner burst and dispatches a 'scan' CustomEvent on a
 *  recognised terminating Enter. Inert unless scanning is enabled, not
 *  suspended (by the Settings measure modal), and an operator is selected. */
export function useScanner(): void {
  const scannerEnabled = useAppStore((s) => s.scannerEnabled);
  const scannerSuspended = useAppStore((s) => s.scannerSuspended);
  const scannerMaxGapMs = useAppStore((s) => s.scannerMaxGapMs);
  const scannerWeaponFormat = useAppStore((s) => s.scannerWeaponFormat);
  const hasOperator = useAppStore((s) => s.operator != null);
  const { t } = useTranslation();

  // Settings must take effect without a re-attach (and without re-running the
  // effect on every keystroke), so the live values are read through refs.
  const maxGapRef = useRef(scannerMaxGapMs);
  maxGapRef.current = scannerMaxGapMs;
  const weaponFormatRef = useRef(scannerWeaponFormat);
  weaponFormatRef.current = scannerWeaponFormat;
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    if (!scannerEnabled || scannerSuspended || !hasOperator) return;

    let buffer = '';
    let lastKeyTime = 0;

    const onKeyDown = (e: KeyboardEvent) => {
      const now = Date.now();

      if (e.key === 'Enter') {
        // An Enter always ends a burst, so the buffer is dropped either way —
        // a partial burst must never join the next one.
        const candidate = buffer;
        buffer = '';

        const withinGap = now - lastKeyTime <= maxGapRef.current;
        if (candidate.length < 3 || !withinGap) return; // too short / gap exceeded: let Enter through untouched

        const scan = classify(candidate, weaponFormatRef.current);
        if (scan.kind === 'weapon' || scan.kind === 'ssn') {
          e.preventDefault();
          e.stopImmediatePropagation();
          window.dispatchEvent(new CustomEvent<Scan>('scan', { detail: scan }));
        } else {
          notifications.show({ color: 'red', message: tRef.current('scan_unknown_code', { raw: scan.raw }) });
        }
        return;
      }

      if (e.key.length === 1) {
        if (now - lastKeyTime > maxGapRef.current) buffer = '';
        buffer += e.key;
        lastKeyTime = now;
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [scannerEnabled, scannerSuspended, hasOperator]);
}

/** Per-page subscription to dispatched scans. Keeps the handler ref current
 *  so pages can pass inline arrow functions without stale closures. */
export function useScan(handler: (scan: Scan) => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const onScan = (e: Event) => handlerRef.current((e as CustomEvent<Scan>).detail);
    window.addEventListener('scan', onScan);
    return () => window.removeEventListener('scan', onScan);
  }, []);
}
