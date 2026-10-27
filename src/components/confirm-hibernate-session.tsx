import { useKeyboard } from "@opentui/react";
import type { Session } from "../../daemon/db/schema";
import { theme } from "../lib/theme";
import { useHibernateSession } from "../queries/use-hibernate-session";
import { PressableText } from "./ui/pressable";

/**
 * The question before putting a session to sleep.
 *
 * It is asked because the cost is invisible. Stopping a session that is idle is
 * free and stopping one mid-turn throws away whatever the agent had got to, and
 * from the roster the two look identical — a row with a filled diamond either
 * way. Nobody can see which one they are about to do, so they are told.
 *
 * The other half is the part that makes this different from removing a session,
 * and it is said just as plainly: the conversation is not going anywhere and
 * neither is the screen. `⌃r` puts an agent back on it. Without that sentence
 * "hibernate" is a word the panel is asking you to trust.
 *
 * `enter` confirms, the same as the other two confirmations here. It is the
 * destructive key and normally a poor default; here it is the entire purpose of
 * the panel, and you had to ask for the panel to see it.
 *
 * The cursor is left where it is, unlike a removal. The row is still there and
 * still the one you were looking at — sending the cursor home would be treating
 * a session that is merely asleep as a session that is gone.
 */
export function ConfirmHibernateSession({
	session,
	onClose,
}: {
	session: Session;
	onClose: () => void;
}) {
	const hibernate = useHibernateSession();

	const confirm = () => {
		if (hibernate.isPending) return;
		hibernate.mutate(session.id, { onSuccess: () => onClose() });
	};

	useKeyboard((key) => {
		if (key.name === "return" || key.name === "enter") confirm();
	});

	return (
		<>
			<text selectable={false} style={{ width: "100%", flexShrink: 0 }}>
				<b style={{ fg: theme.text }}>{session.title}</b>
			</text>
			<text
				selectable={false}
				style={{ width: "100%", flexShrink: 0, fg: theme.muted }}
			>
				{`${session.provider}${session.model ? ` · ${session.model}` : ""}`}
			</text>

			<text
				selectable={false}
				style={{ width: "100%", flexShrink: 0, marginTop: 1, fg: theme.warn }}
			>
				the agent stops here — anything it is part way through is lost
			</text>
			<text
				selectable={false}
				style={{ width: "100%", flexShrink: 0, fg: theme.faint }}
			>
				the conversation and this screen stay · ⌃r wakes it up again
			</text>

			{hibernate.error ? (
				<text
					selectable={false}
					style={{ width: "100%", flexShrink: 0, marginTop: 1, fg: theme.warn }}
				>
					{hibernate.error.message}
				</text>
			) : null}

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
					onPress={confirm}
					style={{ flexShrink: 0, fg: theme.warn }}
				>
					{/* the daemon gives the child two seconds of grace and waits it out
					    before answering, so this label is one somebody will read */}
					{hibernate.isPending ? "  hibernating…  " : "  hibernate  "}
				</PressableText>
				<PressableText
					onPress={onClose}
					style={{ flexShrink: 0, marginLeft: 2, fg: theme.muted }}
				>
					{"  cancel  "}
				</PressableText>
			</box>
		</>
	);
}
