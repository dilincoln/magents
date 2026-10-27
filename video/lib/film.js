/*
 * What every scene in compositions/ is built from: the beat grid, the
 * recorded screens, the product window, captions and lenses.
 *
 * Every time comes from the beat grid. The soundtrack is 132 bpm with its
 * first beat at 1.8325 s (measured with `hyperframes audio --only beats` and
 * fitted), so `beat(k)` and `bar(n)` are the music's own clock, in film time.
 * A scene's timeline runs on its own clock, from 0 at its host's data-start;
 * `scene()` hands back the same grid shifted onto it, so a scene still says
 * "on bar 28" and lands on the music.
 */
(function () {
	const P = 0.45452;
	const T0 = 1.8325;
	const BAR = 4 * P;
	const beat = (k) => T0 + k * P;
	const bar = (n) => beat(4 * n);
	const END = 151.25;

	const plain = (html) => html.replace(/<[^>]*>/g, "");

	/**
	 * One scene: its paused timeline, its elements, and the beat grid on its
	 * clock. `start` is the film time its host starts at in index.html.
	 */
	function scene(id, start) {
		const root = document.querySelector(`[data-composition-id="${id}"]`);
		const duration = Number(root.dataset.duration);
		/*
		 * immediateRender off for every tween: a fromTo placed at 10 s must not
		 * paint its starting state at load. Before its start, an element shows
		 * whatever the CSS (or an earlier tween) says — which is what a renderer
		 * seeking straight to any frame needs.
		 */
		const tl = gsap.timeline({ paused: true, defaults: { immediateRender: false } });
		const s = {
			id,
			tl,
			root,
			start,
			duration,
			q: (sel) => root.querySelector(sel),
			qa: (sel) => [...root.querySelectorAll(sel)],
			beat: (k) => beat(k) - start,
			bar: (n) => bar(n) - start,
			hosts: {},
			/** Registers the timeline, the scene's last moment first. */
			done() {
				tl.set({}, {}, duration);
				window.__timelines = window.__timelines || {};
				window.__timelines[id] = tl;
			},
		};
		return s;
	}

	/** Registers `render(t)` against a timed host, in the host's source time. */
	function source(s, el, render) {
		const hf = window.__hyperframes;
		if (hf && hf.registerFrameSource) {
			hf.registerFrameSource({ element: el, render });
			return;
		}
		// no runtime (opened as a plain page): the same mapping by hand, as a
		// getter/setter tween on the scene's timeline
		const start = Number(el.dataset.start);
		const duration = Number(el.dataset.duration);
		const from = Number(el.dataset.playbackStart || 0);
		let now = from;
		const proxy = {
			t(v) {
				if (v === undefined) return now;
				now = v;
				render(v);
			},
		};
		s.tl.fromTo(proxy, { t: from }, { t: from + duration, duration, ease: "none" }, start);
	}

	// ── the recorded screens ──────────────────────────────────────────────
	/*
	 * A host's data-start, data-duration and data-playback-start say which part
	 * of the take shows when; `clock` turns a moment of the take into scene
	 * time the same way, so anything timed off the recording lands where it
	 * shows.
	 */
	function screen(s, id, take) {
		const el = document.getElementById(id);
		const player = TermPlayer(el, TAKES[take]);
		source(s, el, (t) => player.show(t));
		const start = Number(el.dataset.start);
		const from = Number(el.dataset.playbackStart || 0);
		s.hosts[id] = { take: TAKES[take], clock: (t) => start + (t - from), start, end: start + Number(el.dataset.duration) };
		return s.hosts[id];
	}

	/**
	 * When, in scene time, `text` is on a host's screen: from the first frame
	 * showing it to the frame that no longer does. `row` narrows it to one row.
	 */
	function onScreen(s, id, text, row = null) {
		const { take, clock, start, end } = s.hosts[id];
		let first = null;
		let last = null;
		take.frames.forEach((frame, i) => {
			const rows = row === null ? frame.rows : [frame.rows[row]];
			if (!rows.some((r) => plain(take.rowsDict[r]).includes(text))) return;
			if (first === null) first = frame.t;
			last = take.frames[i + 1]?.t ?? take.duration;
		});
		if (first === null) throw new Error(`"${text}" never shows on ${id}`);
		return [Math.max(start, clock(first)), Math.min(end, clock(last))];
	}

	// ── the product window ───────────────────────────────────────────────
	/*
	 * Each feature scene has its own copy of the window, in the same place, so
	 * one scene hands over to the next without a seam. Off the split it moves
	 * only inside a scene (the roster's push-in, the CLI's step back, the
	 * recap's bow), and is back in place by the scene's end.
	 */
	const SPLIT = { x: 540, y: 150, scale: 0.78 };
	const haloAt = (w) => ({ x: w.x + 840 * w.scale - 750, y: w.y + 492 * w.scale - 450 });

	/**
	 * Puts the window and its halo on the split, breathes the halo on the beat,
	 * and — when the scene starts on a cut — sends light across the screen.
	 */
	function product(s, { cut = true } = {}) {
		const win = s.q(".window.main");
		const halo = s.q(".halo");
		s.tl.set(win, SPLIT, 0);
		s.tl.set(halo, haloAt(SPLIT), 0);
		// the beat breathes through the halo, from the window's first bar to
		// the recap
		for (let k = 4 * 14; k < 4 * 76; k++) {
			const t = s.beat(k);
			if (t < 0 || t >= s.duration) continue;
			const strong = k % 4 === 0;
			s.tl.fromTo(halo, { opacity: strong ? 0.85 : 0.6 }, { opacity: 0.32, duration: P * 0.9, ease: "power2.out" }, t);
		}
		if (cut) {
			s.tl.fromTo(win.querySelector(".glint"), { opacity: 1, x: 0 }, { x: 2600, duration: 0.6, ease: "power2.inOut" }, 0);
			s.tl.fromTo(win.querySelector(".body"), { filter: "brightness(1.45)" }, { filter: "brightness(1)", duration: 0.45, ease: "power2.out" }, 0);
		}
		return { win, halo };
	}

	/** A caption's lines rise in one after another, and leave together. */
	function caption(s, from = 0, to = s.duration) {
		const kids = [...s.q(".cap").children];
		s.tl.fromTo(kids, { opacity: 0, y: 36 }, { opacity: 1, y: 0, duration: 0.55, stagger: P / 2, ease: "power3.out" }, from);
		s.tl.to(kids, { opacity: 0, y: -22, duration: 0.25, stagger: 0.03, ease: "power2.in" }, to - 0.35);
	}

	// ── lenses: the detail that matters, drawn bigger ────────────────────
	/*
	 * A lens is on screen exactly while what it magnifies is: it opens once the
	 * thing is there and is gone before the thing goes, so it never shows the
	 * terminal the moment before or after.
	 *
	 * While it is open the window behind it goes out of focus and a little
	 * darker, so the eye has two places to be — the caption and the lens — and
	 * comes back into focus as the lens closes.
	 */
	const SHARP = { filter: "blur(0px) brightness(1) saturate(1)" };
	const SOFT = { filter: "blur(9px) brightness(0.55) saturate(0.8)" };
	function lens(s, region, zoom, at, [from, to]) {
		const el = s.q(".lens");
		const win = s.q(".window.main");
		el.style.width = `${region.w * zoom}px`;
		el.style.height = `${region.h * zoom}px`;
		// translate first, then scale about the corner: the region's top-left
		// lands on the lens's
		el.querySelector(".lens-in").style.transform = `scale(${zoom}) translate(${-region.x}px, ${-region.y}px)`;
		s.tl.set(el, { x: at[0], y: at[1] }, 0);
		s.tl.fromTo(win, SHARP, { ...SOFT, duration: 0.3, ease: "power2.out" }, from);
		s.tl.fromTo(el, { opacity: 0, scale: 0.94, y: at[1] + 16 }, { opacity: 1, scale: 1, y: at[1], duration: 0.35, ease: "back.out(1.4)" }, from + 0.05);
		s.tl.to(el, { opacity: 0, scale: 0.97, duration: 0.22, ease: "power2.in" }, to - 0.25);
		s.tl.fromTo(win, SOFT, { ...SHARP, duration: 0.3, ease: "power2.inOut" }, to - 0.22);
		return el;
	}

	/** A feature scene's usual shape: window on the split, its screen, its caption. */
	function feature(id, start, { take, cut = true, captionFrom = 0 }) {
		const s = scene(id, start);
		product(s, { cut });
		screen(s, `h-${id}`, take);
		caption(s, captionFrom);
		return s;
	}

	/** Wraps each word of an element in a span, to stagger them in. */
	function splitWords(el) {
		el.innerHTML = el.textContent
			.split(" ")
			.map((w) => `<span class="w" style="display:inline-block;opacity:0">${w}</span>`)
			.join(" ");
	}

	window.Film = {
		P,
		T0,
		BAR,
		END,
		beat,
		bar,
		plain,
		scene,
		source,
		screen,
		onScreen,
		SPLIT,
		haloAt,
		product,
		caption,
		lens,
		feature,
		splitWords,
	};
})();
