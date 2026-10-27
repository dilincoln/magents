import type { Skill } from "./read-skills";

/**
 * How a skill reads once it is in the text.
 *
 * One definition, used by the thing that writes it and by the thing that has to
 * recognise what it wrote. The picker closes itself when the word under the
 * caret is exactly what it just inserted, and that comparison is only sound
 * while both sides spell it the same way.
 *
 * The trailing space is part of it: a skill is never the whole message, and the
 * next thing typed is what to do with it.
 */
export const skillMention = (skill: Skill): string => `/${skill.name} `;
