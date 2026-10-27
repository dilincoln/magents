import { queryOptions } from "@tanstack/react-query";
import { readSkills } from "../lib/read-skills";

/**
 * The skills a project can reach, both providers, global and local.
 *
 * Keyed by the project so two projects do not share a list, and cached like
 * everything else: reading four directories and a `SKILL.md` in each folder is
 * not work to redo on a keystroke.
 */
export const skillsQuery = (projectPath: string) =>
	queryOptions({
		queryKey: ["skills", projectPath],
		queryFn: () => readSkills(projectPath),
	});
