/*
 * Plays a recorded take (capture/record.ts) into a `.term` element.
 *
 *   const player = TermPlayer(el, take);
 *   player.show(seconds);   // the screen as it was that many seconds in
 *
 * Pure function of time: the frame shown at t is the last one recorded at or
 * before t, so seeking anywhere in any order lands on the same pixels.
 * Only rows that differ from what is already on screen are rewritten.
 */
(function () {
	function TermPlayer(el, take) {
		el.classList.add("term");
		el.innerHTML = "";
		el.style.width = `calc(var(--cw) * ${take.cols})`;
		el.style.height = `calc(var(--lh) * ${take.rows})`;
		const rows = [];
		for (let r = 0; r < take.rows; r++) {
			const div = document.createElement("div");
			div.className = "row";
			el.appendChild(div);
			rows.push({ div, id: -1 });
		}
		const cursor = document.createElement("div");
		cursor.className = "cursor";
		el.appendChild(cursor);

		let current = -1;
		const frames = take.frames;

		function frameAt(t) {
			let lo = 0;
			let hi = frames.length - 1;
			if (t <= frames[0].t) return 0;
			while (lo < hi) {
				const mid = (lo + hi + 1) >> 1;
				if (frames[mid].t <= t) lo = mid;
				else hi = mid - 1;
			}
			return lo;
		}

		function paint(index) {
			if (index === current) return;
			current = index;
			const frame = frames[index];
			for (let r = 0; r < rows.length; r++) {
				const id = frame.rows[r];
				if (rows[r].id !== id) {
					rows[r].id = id;
					rows[r].div.innerHTML = take.rowsDict[id];
				}
			}
			if (frame.cursor) {
				cursor.style.display = "block";
				cursor.style.left = `calc(var(--cw) * ${frame.cursor[0]})`;
				cursor.style.top = `calc(var(--lh) * ${frame.cursor[1]})`;
			} else {
				cursor.style.display = "none";
			}
		}

		return {
			take,
			show(t) {
				paint(frameAt(t));
			},
			frame(index) {
				paint(Math.max(0, Math.min(frames.length - 1, index)));
			},
		};
	}
	const plain = (html) => html.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

	/** The time of the first frame at or after `from` whose screen contains `text`. */
	TermPlayer.find = (take, text, from = 0, row = null) => {
		for (const frame of take.frames) {
			if (frame.t < from) continue;
			const rows = row === null ? frame.rows : [frame.rows[row]];
			if (rows.some((id) => plain(take.rowsDict[id]).includes(text))) return frame.t;
		}
		return null;
	};

	/** The row a piece of text is on in the frame shown at `t`. */
	TermPlayer.rowOf = (take, text, t) => {
		let frame = take.frames[0];
		for (const f of take.frames) if (f.t <= t) frame = f;
		return frame.rows.findIndex((id) => plain(take.rowsDict[id]).includes(text));
	};

	/** The first time at or after `from` that `text`'s row has background `colour`. */
	TermPlayer.lit = (take, text, colour, from = 0) => {
		for (const frame of take.frames) {
			if (frame.t < from) continue;
			const html = frame.rows.map((id) => take.rowsDict[id]).find((h) => plain(h).includes(text));
			if (html && html.includes(colour)) return frame.t;
		}
		return null;
	};

	window.TermPlayer = TermPlayer;
})();
