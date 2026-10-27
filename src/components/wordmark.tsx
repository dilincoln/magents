import type { TextRenderable } from "@opentui/core";
import { useMemo, useRef } from "react";
import { useFrame } from "../hooks/use-frame";
import { flags } from "../lib/flags";
import {
	buildColumns,
	buildRamp,
	paintWordmark,
	RESTING,
	sweepLevel,
} from "../lib/wordmark";

/**
 * A highlight band sweeping left to right, always running.
 *
 * The 60fps value never enters component state: the frame callback writes
 * straight to the renderable through a ref, so the sweep costs no React renders
 * at all. This component renders once and then never again.
 *
 * `--no-pulse` is the only thing that can stop it, and it is read at startup —
 * so `flags.pulse` is constant for the process and needs no reset path. The
 * initial `content` is the resting mark, which is what stays on screen when the
 * frame callback is never installed.
 */
export function Wordmark({ text = "MAGENTS" }: { text?: string }) {
	const node = useRef<TextRenderable>(null);
	const clock = useRef(0);

	const { columns, ramp } = useMemo(() => {
		const columns = buildColumns(text);
		return { columns, ramp: buildRamp(columns) };
	}, [text]);

	const resting = useMemo(
		() => paintWordmark(columns, ramp, () => RESTING),
		[columns, ramp],
	);

	useFrame((dt) => {
		clock.current += dt;
		if (node.current) {
			node.current.content = paintWordmark(columns, ramp, (u) =>
				sweepLevel(u, clock.current),
			);
		}
	}, flags.pulse);

	return (
		<text
			ref={node}
			content={resting}
			selectable={false}
			style={{ flexShrink: 0 }}
		/>
	);
}
