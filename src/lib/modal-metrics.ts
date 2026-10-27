const BORDER = 1;
const PADDING = 2;

/**
 * The panel's geometry, in one place.
 *
 * The primitive styles itself from this and callers size their content from it,
 * so the padding cannot change and leave a content width behind. That width is
 * not cosmetic: it is what a wrapped description is measured against, and a
 * column of drift moves the wrap point on every line.
 */
export const modalMetrics = {
	padding: PADDING,
	/** how much room the content actually has inside a panel of this width */
	inner: (width: number): number => width - 2 * (BORDER + PADDING),
};
