import type { TextRenderable } from "@opentui/core";
import type { TextProps } from "@opentui/react";
import { useEffect, useRef } from "react";

interface CharsAnimationProps {
	chars: string[];
	speed?: number;
	textProps?: Omit<TextProps, "ref">;
}

export function CharsAnimation({
	chars,
	speed = 100,
	textProps,
}: CharsAnimationProps) {
	const textRef = useRef<TextRenderable>(null);

	useEffect(() => {
		let index = 0;

		const interval = setInterval(() => {
			if (!textRef.current) {
				return;
			}

			textRef.current.content = chars[index] || "";

			index = (index + 1) % chars.length;
		}, speed);

		return () => {
			clearInterval(interval);
		};
	}, [chars, speed]);

	return <text {...textProps} ref={textRef} />;
}
