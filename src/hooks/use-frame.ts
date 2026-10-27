import { useRenderer } from "@opentui/react";
import { useEffect, useRef } from "react";

/**
 * Runs `callback` once per rendered frame, with the delta in seconds.
 *
 * This is the escape hatch for animation: 60fps values never touch component
 * state, they mutate the renderable through a ref. The renderer keeps a list of
 * frame callbacks, so several components can use this at once.
 */
export function useFrame(callback: (dt: number) => void, enabled = true): void {
	const renderer = useRenderer();
	const latest = useRef(callback);
	latest.current = callback;

	useEffect(() => {
		if (!enabled) return;

		const onFrame = async (deltaMs: number) => {
			latest.current(deltaMs / 1000);
		};

		renderer.setFrameCallback(onFrame);
		return () => renderer.removeFrameCallback(onFrame);
	}, [renderer, enabled]);
}
