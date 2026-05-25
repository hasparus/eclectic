import type { Attachment } from 'svelte/attachments';

// --- Global cursor lock ---
// Injects a single shared <style> into <head> that forces a cursor on
// every element via `!important`. Used by drag handles and pan
// controls so the cursor stays locked even when the pointer leaves the
// drag zone.

let cursorStyleEl: HTMLStyleElement | null = null;

/**
 * Lock the cursor globally to the given CSS cursor value.
 */
export function lockCursor(cursor: string): void {
	if (!cursorStyleEl) {
		cursorStyleEl = document.createElement('style');
		document.head.appendChild(cursorStyleEl);
	}
	cursorStyleEl.textContent = `* { cursor: ${cursor} !important; }`;
}

/** Remove the global cursor lock. */
export function unlockCursor(): void {
	if (cursorStyleEl) {
		cursorStyleEl.remove();
		cursorStyleEl = null;
	}
}

export interface TouchDragCallbacks {
	shouldStart?: () => boolean;
	onDown?: (clientX: number, clientY: number) => void;
	onMove: (clientX: number, clientY: number) => void;
	onUp?: () => void;
}

/**
 * Touch-aware drag attachment.
 *
 * Mouse/pen: drag starts immediately on pointerdown.
 * Touch: user must hold still for 300ms before drag activates
 * (disambiguates from page scroll).
 *
 * Toggles CSS classes on the element automatically:
 *   .dragging      — while actively dragging (mouse or touch)
 *   .touch-locked  — once the touch hold threshold passes
 *
 * Usage:
 *
 *   <div {@attach touchDrag({ onMove, onDown, onUp })}>
 */
export function touchDrag(callbacks: TouchDragCallbacks): Attachment {
	const HOLD_MS = 300;
	const MOVE_TOL = 8;

	return (node) => {
		const el = node as HTMLElement;
		let dragging = false;
		let locked = false;
		let timer: ReturnType<typeof setTimeout> | null = null;
		let startX = 0;
		let startY = 0;

		function setDragging(v: boolean): void {
			dragging = v;
			el.classList.toggle('dragging', v);
		}

		function setLocked(v: boolean): void {
			locked = v;
			el.classList.toggle('touch-locked', v);
		}

		function canStart(): boolean {
			return !callbacks.shouldStart || callbacks.shouldStart();
		}

		function endDrag(): void {
			const was = dragging;
			clearActiveTimer();
			setLocked(false);
			setDragging(false);
			if (was) callbacks.onUp?.();
		}

		function clearActiveTimer(): void {
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
		}

		// --- Pointer (mouse / pen — immediate) ---

		function onPointerDown(e: PointerEvent): void {
			if (e.pointerType === 'touch' || !canStart()) return;
			e.preventDefault();
			e.stopPropagation();
			setDragging(true);
			callbacks.onDown?.(e.clientX, e.clientY);
		}

		function onPointerMove(e: PointerEvent): void {
			if (e.pointerType === 'touch' || !dragging) return;
			callbacks.onMove(e.clientX, e.clientY);
		}

		function onPointerUp(e: PointerEvent): void {
			if (e?.pointerType === 'touch' || !dragging) return;
			setDragging(false);
			callbacks.onUp?.();
		}

		// --- Touch (hold-then-drag) ---

		function onTouchStart(e: TouchEvent): void {
			if (e.touches.length !== 1 || !canStart()) return;
			const t = e.touches[0];
			startX = t.clientX;
			startY = t.clientY;
			clearActiveTimer();
			timer = setTimeout(() => {
				timer = null;
				setLocked(true);
				setDragging(true);
				callbacks.onDown?.(startX, startY);
			}, HOLD_MS);
		}

		function onTouchMove(e: TouchEvent): void {
			if (e.touches.length !== 1) {
				endDrag();
				return;
			}
			const t = e.touches[0];
			if (!locked) {
				if (
					timer &&
					(Math.abs(t.clientX - startX) > MOVE_TOL ||
						Math.abs(t.clientY - startY) > MOVE_TOL)
				) {
					clearActiveTimer();
				}
				return;
			}
			e.preventDefault();
			callbacks.onMove(t.clientX, t.clientY);
		}

		// --- Bind ---

		el.addEventListener('pointerdown', onPointerDown);
		el.addEventListener('touchstart', onTouchStart, { passive: true });
		el.addEventListener('touchmove', onTouchMove, { passive: false });
		el.addEventListener('touchend', endDrag);
		el.addEventListener('touchcancel', endDrag);
		window.addEventListener('pointermove', onPointerMove);
		window.addEventListener('pointerup', onPointerUp);

		return () => {
			endDrag();
			el.removeEventListener('pointerdown', onPointerDown);
			el.removeEventListener('touchstart', onTouchStart);
			el.removeEventListener('touchmove', onTouchMove);
			el.removeEventListener('touchend', endDrag);
			el.removeEventListener('touchcancel', endDrag);
			window.removeEventListener('pointermove', onPointerMove);
			window.removeEventListener('pointerup', onPointerUp);
		};
	};
}
