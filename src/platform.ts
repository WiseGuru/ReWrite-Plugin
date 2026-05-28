import { Platform } from 'obsidian';
import { ActiveProfileKind, EnvironmentProfile, GlobalSettings } from './types';

export function detectActiveProfileKind(settings: GlobalSettings): ActiveProfileKind {
	switch (settings.activeProfileOverride) {
		case 'desktop':
			return 'desktop';
		case 'mobile':
			return 'mobile';
		case 'auto':
		default:
			return Platform.isDesktop ? 'desktop' : 'mobile';
	}
}

export function resolveActiveProfile(settings: GlobalSettings): {
	kind: ActiveProfileKind;
	profile: EnvironmentProfile;
} {
	const kind = detectActiveProfileKind(settings);
	const profile = kind === 'desktop' ? settings.desktopProfile : settings.mobileProfile;
	return { kind, profile };
}

export function isMediaRecorderAvailable(): boolean {
	return typeof MediaRecorder !== 'undefined' && typeof navigator !== 'undefined' && !!navigator.mediaDevices;
}

// Mobile soft-keyboards routinely cover whichever input just received focus.
// This helper attaches a `focusin` listener to `root` and, when on mobile,
// brings the focused input/textarea into the visible region above the
// keyboard. Android WebViews do NOT resize the layout viewport when the
// keyboard opens (iOS does), so a bare `scrollIntoView({ block: 'center' })`
// centers the input on the full screen, which is then covered by the
// keyboard. We use `window.visualViewport` to read the actual post-keyboard
// visible region, then:
//   1. Scroll the nearest scrollable ancestor by the delta needed to lift
//      the input. On the settings tab this fully resolves the case.
//   2. If the input is still below the visible region (typical for short
//      Obsidian popups whose `.modal-content` has no scroll room), shrink
//      the enclosing `.modal-container` to the visible region via inline
//      `top`/`height`. Obsidian centers `.modal` inside `.modal-container`
//      via flex, so the popup re-positions above the keyboard. Restore on
//      blur. Scrolling cannot move a `position: fixed` modal up by itself.
// Falls back to `scrollIntoView` when `visualViewport` is unavailable. Safe
// to call on desktop; it returns immediately. The caller's element is
// expected to outlive the listener (Obsidian re-empties containers across
// renders rather than detaching them), so no explicit teardown is provided.
export function installMobileKeyboardScrollFix(root: HTMLElement): void {
	if (!Platform.isMobile) return;
	root.addEventListener('focusin', (event) => {
		const target = event.target;
		if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) return;
		const vv = window.visualViewport;
		if (!vv) {
			window.setTimeout(() => {
				try {
					target.scrollIntoView({ block: 'center', behavior: 'smooth' });
				} catch {
					target.scrollIntoView();
				}
			}, 300);
			return;
		}

		const act = () => liftAboveKeyboard(target, vv);
		// If the keyboard is already up (visual viewport already shrunk), act now.
		if (vv.height < window.innerHeight - 100) {
			window.setTimeout(act, 50);
			return;
		}
		// Otherwise wait for the visual viewport to shrink (keyboard opens),
		// with a safety timeout so we still scroll if no resize fires.
		let done = false;
		const onResize = () => {
			if (done) return;
			done = true;
			vv.removeEventListener('resize', onResize);
			window.clearTimeout(timer);
			act();
		};
		const timer = window.setTimeout(() => {
			if (done) return;
			done = true;
			vv.removeEventListener('resize', onResize);
			act();
		}, 600);
		vv.addEventListener('resize', onResize);
	});
}

function liftAboveKeyboard(target: HTMLElement, vv: VisualViewport): void {
	const margin = 16;
	const visibleBottom = vv.offsetTop + vv.height;
	let rect = target.getBoundingClientRect();
	if (rect.bottom <= visibleBottom - margin) return;
	let delta = rect.bottom - (visibleBottom - margin);

	// First try scrolling the nearest scrollable ancestor. This is what works
	// on the settings page (the inner tab-content scrolls and the input rises
	// into the visible region).
	const scrollable = findScrollableAncestor(target);
	if (scrollable) {
		scrollable.scrollTop += delta;
		rect = target.getBoundingClientRect();
		if (rect.bottom <= visibleBottom - margin) return;
		delta = rect.bottom - (visibleBottom - margin);
	}

	// Still hidden. The input lives inside a `position: fixed` popup whose
	// `.modal-content` doesn't have enough scroll room (passphrase modal,
	// rename prompt, the Paste tab modal, etc.). Shrink the enclosing
	// `.modal-container` to the visible region; Obsidian centers `.modal`
	// inside it via flex, so the popup re-positions above the keyboard.
	const container = findModalContainer(target);
	if (container) {
		applyModalContainerLift(container, target, vv);
		return;
	}
	window.scrollBy(0, delta);
}

function findScrollableAncestor(el: HTMLElement): HTMLElement | null {
	let node: HTMLElement | null = el.parentElement;
	while (node && node !== document.body) {
		const style = window.getComputedStyle(node);
		const overflowY = style.overflowY;
		if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
			return node;
		}
		node = node.parentElement;
	}
	return null;
}

function findModalContainer(el: HTMLElement): HTMLElement | null {
	let node: HTMLElement | null = el.parentElement;
	while (node && node !== document.body) {
		if (node.classList.contains('modal-container')) return node;
		node = node.parentElement;
	}
	return null;
}

function applyModalContainerLift(container: HTMLElement, target: HTMLElement, vv: VisualViewport): void {
	const prevTop = container.style.top;
	const prevHeight = container.style.height;
	container.style.top = `${vv.offsetTop}px`;
	container.style.height = `${vv.height}px`;
	let restored = false;
	const restore = () => {
		if (restored) return;
		restored = true;
		target.removeEventListener('blur', onBlur);
		vv.removeEventListener('resize', onResize);
		container.style.top = prevTop;
		container.style.height = prevHeight;
	};
	const onBlur = () => restore();
	const onResize = () => {
		// Keyboard closed: visual viewport returns to roughly full window height.
		if (vv.height >= window.innerHeight - 50) restore();
		else {
			// Keyboard height may have changed (e.g., emoji panel toggled);
			// re-fit the container.
			container.style.top = `${vv.offsetTop}px`;
			container.style.height = `${vv.height}px`;
		}
	};
	target.addEventListener('blur', onBlur);
	vv.addEventListener('resize', onResize);
}
