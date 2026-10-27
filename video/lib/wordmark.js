/*
 * The magents wordmark, painted the way the TUI paints it (src/lib/wordmark.ts):
 * the "tiny" block font, a cyan → violet ramp across the columns, each column
 * mixed between a dim and a bright end by a band of light that sweeps left to
 * right. Same maths, as a pure function of time.
 *
 *   const mark = Wordmark(el, { cycle, lift });
 *   mark.paint(seconds);
 *
 * `cycle` is one sweep's length (the TUI's is 2.6 s; the film uses one bar, so
 * the light crosses on the beat) and `lift` how far the bright end goes towards
 * white (the TUI's is 0.5).
 */
(function () {
	const ROWS = ["█▀▄▀█ ▄▀█ █▀▀ █▀▀ █▄ █ ▀█▀ █▀▀", "█ ▀ █ █▀█ █▄█ ██▄ █ ▀█  █  ▄▄█"];
	const BAND = 0.28;
	const ACCENT = [0x22, 0xd3, 0xee];
	const VIOLET = [0xa7, 0x8b, 0xfa];
	const BG = [0x0a, 0x0c, 0x14];
	const WHITE = [0xff, 0xff, 0xff];

	const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
	const css = (c) => `rgb(${c.map((v) => Math.round(v)).join(",")})`;
	const width = ROWS[0].length;

	function Wordmark(el, { cycle = 2.6, lift = 0.5 } = {}) {
		const ramp = Array.from({ length: width }, (_, x) => {
			const u = x / (width - 1);
			const base = mix(ACCENT, VIOLET, u);
			return { u, dim: mix(BG, base, 0.62), bright: mix(base, WHITE, lift) };
		});
		const level = (u, t) => {
			const head = ((((t % cycle) + cycle) % cycle) / cycle) * 1.5 - 0.25;
			const falloff = Math.max(0, 1 - Math.abs(u - head) / BAND) ** 2;
			return 0.2 + 0.8 * falloff;
		};

		el.classList.add("term");
		el.style.background = "transparent";
		el.style.width = `calc(var(--cw) * ${width})`;
		el.style.height = `calc(var(--lh) * ${ROWS.length})`;
		const rows = ROWS.map(() => {
			const div = document.createElement("div");
			div.className = "row";
			el.appendChild(div);
			return div;
		});
		// a cell box, not a space: the font's space is 0.6em, the cell is --cw
		const cell = (ch) =>
			ch === " " ? `<i class="g"></i>` : `<i class="x" data-c="${ch.codePointAt(0).toString(16)}"></i>`;

		return {
			width,
			paint(t) {
				ROWS.forEach((text, r) => {
					let html = "";
					for (let x = 0; x < width; x++) {
						const { u, dim, bright } = ramp[x];
						html += `<span style="color:${css(mix(dim, bright, level(u, t)))}">${cell(text[x])}</span>`;
					}
					rows[r].innerHTML = html;
				});
			},
		};
	}
	window.Wordmark = Wordmark;
})();
