/**
 * The `name` and `description` out of a YAML frontmatter block.
 *
 * Two fields, read with two regexes and no YAML parser. That is not laziness
 * about the format — it is a refusal to pull a dependency in for a header whose
 * shape we control: anything else in the block is skipped, and a file with no
 * block at all comes back empty rather than throwing.
 */
export function parseFrontmatter(content: string): {
	name?: string;
	description?: string;
} {
	const block = content.match(/^---\s*\n([\s\S]*?)\n---/)?.[1];
	if (!block) return {};

	return {
		name: block.match(/^name:\s*(.+)$/m)?.[1]?.trim(),
		description: block.match(/^description:\s*(.+)$/m)?.[1]?.trim(),
	};
}
