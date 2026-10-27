import type { BoxProps, TextProps } from "@opentui/react";
import type { PropsWithChildren } from "react";
import { getRandomLoadingChar } from "../constants/loading-chars";
import { CharsAnimation } from "./ui/chars-animation";

interface LoadingProps {
	boxProps?: BoxProps;
	textProps?: TextProps;
}

export function Loading({
	boxProps,
	textProps,
	children,
}: PropsWithChildren<LoadingProps>) {
	return (
		<box gap={1} flexDirection="row" {...boxProps}>
			<CharsAnimation chars={getRandomLoadingChar()} />

			{children || <text {...textProps}>Loading...</text>}
		</box>
	);
}
