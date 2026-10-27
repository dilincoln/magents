export const LOADING_CHARS_VARIANT_1 = [
	"⠋",
	"⠙",
	"⠹",
	"⠸",
	"⠼",
	"⠴",
	"⠦",
	"⠧",
	"⠇",
	"⠏",
];

export const LOADING_CHARS_VARIANT_2 = ["⠁", "⠂", "⠄", "⡀", "⢀", "⠠", "⠐", "⠈"];

const allLoadings = [LOADING_CHARS_VARIANT_1, LOADING_CHARS_VARIANT_2];

export function getRandomLoadingChar() {
	const index = Math.floor(Math.random() * allLoadings.length);

	const char = allLoadings[index];

	if (!char) {
		throw new Error("No loading char found");
	}

	return char;
}
