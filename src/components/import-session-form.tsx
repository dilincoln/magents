import { useKeyboard } from "@opentui/react";
import { useEffect, useState } from "react";
import { barCursor } from "../constants/bar-cursor";
import { theme } from "../lib/theme";
import { useImportSession } from "../queries/use-import-session";
import { useAppStore } from "../store/use-app-store";
import { useModalStore } from "../store/use-modal-store";
import { Loading } from "./loading";
import { PressableText } from "./ui/pressable";

/**
 * The handle of a conversation that already exists, sent to the daemon.
 *
 * Two fields, and only one of them is a fact. A session started by hand in a
 * terminal has exactly one thing pointing at it — the id the provider printed —
 * and everything else about it is written down beside the transcript: which
 * provider holds it, which directory it ran in, what the first thing said was.
 * Asking for any of that here would be asking someone to retype what the daemon
 * can read, and to be wrong about it in ways that look like a bad id.
 *
 * The name is the exception, and it is asked for because nothing on disk knows
 * it. The transcript can offer a guess and for a fork the guess is worthless —
 * a fork's own first line is the ping that made it — so the one moment somebody
 * is definitely thinking about this conversation is the moment they are
 * importing it. That is when to ask.
 *
 * So there is no provider picker and no project picker. The folder is
 * registered as a project if it is not one already, because a session has to
 * hang under something in the roster and the folder it ran in is the only
 * honest answer.
 *
 * A claude import takes a few seconds and the hint says why: it is forked
 * rather than resumed, which is a real turn against the provider. That is not
 * an implementation detail worth hiding — the row that appears has an id you
 * have never seen, and somebody who was not told to expect that would be right
 * to think the import went to the wrong place.
 *
 * And for those few seconds there is no way out, because there is nothing a way
 * out could do. The fork is already running on the other side and closing the
 * panel would not recall it — it would only take away the one screen that is
 * going to say how it went. So the buttons are replaced by the spinner rather
 * than greyed out, and the modal is locked while it spins, which takes `esc`
 * and the click-away with it.
 *
 * The only state declared here is the id. Whether the call is in flight and
 * what it said when it failed belong to the mutation, which already knows both;
 * keeping local copies alongside it is how the two end up disagreeing.
 */
export function ImportSessionForm({ onClose }: { onClose: () => void }) {
	const [id, setId] = useState("");
	const [name, setName] = useState("");
	// Which field has the caret. Two inputs and one keyboard, so somebody has to
	// hold the answer; the renderer will focus every input that says it is
	// focused, and two carets is worse than none.
	const [field, setField] = useState<"id" | "name">("id");
	const bring = useImportSession();
	const lockModal = useModalStore((state) => state.lockModal);

	const ready =
		id.trim().length > 0 && name.trim().length > 0 && !bring.isPending;

	// The cleanup is not belt and braces: `onClose` fires from inside
	// `onSuccess`, which is before this component is told the mutation settled,
	// so unmounting is the moment the lock has to come off if nothing else took
	// it off first.
	useEffect(() => {
		lockModal(bring.isPending);
		return () => lockModal(false);
	}, [bring.isPending, lockModal]);

	// Tab walks the two fields. It reaches this rather than the roster's `⌃i`
	// fallback because a modal owns the keyboard and is answered first — see the
	// owner switch in the screen.
	useKeyboard((key) => {
		if (bring.isPending || key.name !== "tab") return;
		setField((at) => (at === "id" ? "name" : "id"));
		key.preventDefault();
		key.stopPropagation();
	});

	/**
	 * What enter does, which depends on what is still missing.
	 *
	 * A form that submitted on the first enter would submit half-filled from the
	 * first field every time, and one that only ever advanced would never send
	 * from the last field. So enter finishes the form when the form is finished,
	 * and otherwise goes to whatever is still empty.
	 */
	const confirm = () => {
		if (bring.isPending) return;
		if (!id.trim()) return setField("id");
		if (!name.trim()) return setField("name");
		submit();
	};

	const submit = () => {
		// no double submits: enter is easy to hit twice, and the second one would
		// race the first with a form that is already gone
		if (!ready) return;

		bring.mutate(
			{ externalId: id.trim(), title: name.trim() },
			{
				onSuccess: ({ session }) => {
					// Where the cursor goes, and nothing else. The daemon has already put
					// a process on the session by the time this answers, so there is no
					// second step to ask for — including when the row was already there,
					// where following it is the useful part of finding that out.
					useAppStore.getState().opened(session.id);
					onClose();
				},
			},
		);
	};

	return (
		<>
			<text
				selectable={false}
				style={{
					width: "100%",
					flexShrink: 0,
					marginBottom: 1,
					fg: theme.muted,
				}}
			>
				claude or codex session id
			</text>

			{/* its own click, so the pointer can pick a field the way tab does */}
			<box
				onMouseDown={() => setField("id")}
				style={{
					width: "100%",
					flexShrink: 0,
					flexDirection: "row",
					backgroundColor: theme.bg,
				}}
			>
				<text
					selectable={false}
					style={{ flexShrink: 0, fg: theme.accent, bg: theme.bg }}
				>
					{" "}
				</text>

				<input
					focused={field === "id" && !bring.isPending}
					value={id}
					placeholder="7ecb2bd5-1e8c-43f1-8cb5-c65fb48e3be2"
					onInput={setId}
					onSubmit={confirm}
					style={{
						flexGrow: 1,
						flexShrink: 1,
						backgroundColor: theme.bg,
						focusedBackgroundColor: theme.bg,
						textColor: theme.text,
						focusedTextColor: theme.text,
						placeholderColor: theme.faint,
						cursorColor: theme.accent,
						cursorStyle: barCursor,
					}}
				/>
			</box>

			<text
				selectable={false}
				style={{
					width: "100%",
					flexShrink: 0,
					marginTop: 1,
					marginBottom: 1,
					fg: theme.muted,
				}}
			>
				name
			</text>

			{/* its own click, so the pointer can pick a field the way tab does */}
			<box
				onMouseDown={() => setField("name")}
				style={{
					width: "100%",
					flexShrink: 0,
					flexDirection: "row",
					backgroundColor: theme.bg,
				}}
			>
				<text
					selectable={false}
					style={{ flexShrink: 0, fg: theme.accent, bg: theme.bg }}
				>
					{" "}
				</text>

				<input
					focused={field === "name" && !bring.isPending}
					value={name}
					placeholder="what this conversation is about"
					onInput={setName}
					onSubmit={confirm}
					style={{
						flexGrow: 1,
						flexShrink: 1,
						backgroundColor: theme.bg,
						focusedBackgroundColor: theme.bg,
						textColor: theme.text,
						focusedTextColor: theme.text,
						placeholderColor: theme.faint,
						cursorColor: theme.accent,
						cursorStyle: barCursor,
					}}
				/>
			</box>

			{/* the backend's own sentence, not a translation of it: it is the only
			    thing that looked, and "no claude or codex session with that id" is
			    the answer a mistyped character earns */}
			<text
				selectable={false}
				style={{
					width: "100%",
					flexShrink: 0,
					marginTop: 1,
					fg: bring.error ? theme.warn : theme.faint,
				}}
			>
				{bring.error?.message ??
					(bring.isPending
						? "the fork is a real turn against the provider, so this is not instant"
						: "tab switches fields · a claude session is forked, so the one you pasted keeps running")}
			</text>

			{/* One row either way, so the panel does not jump when it starts. What
			    is in it is the whole state: two things to press, or the one thing
			    happening — and never a cancel with nothing left to cancel. */}
			{bring.isPending ? (
				<Loading
					boxProps={{
						style: {
							width: "100%",
							flexShrink: 0,
							marginTop: 1,
							backgroundColor: theme.panel,
						},
					}}
				>
					<text selectable={false} style={{ fg: theme.accent }}>
						bringing it in…
					</text>
				</Loading>
			) : (
				<box
					style={{
						width: "100%",
						flexShrink: 0,
						flexDirection: "row",
						marginTop: 1,
						backgroundColor: theme.panel,
					}}
				>
					<PressableText
						// withheld rather than refused while the field is empty, so the
						// button looks as dead as it is — a thing that lights up under the
						// pointer and then does nothing is worse than a grey one
						onPress={ready ? submit : undefined}
						style={{ flexShrink: 0, fg: ready ? theme.accent : theme.faint }}
					>
						{"  import  "}
					</PressableText>
					<PressableText
						onPress={onClose}
						style={{ flexShrink: 0, marginLeft: 2, fg: theme.muted }}
					>
						{"  cancel  "}
					</PressableText>
				</box>
			)}
		</>
	);
}
