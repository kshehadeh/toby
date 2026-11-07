import { dueInstant } from "./recurrence";
import { todosNeedRestoreReview } from "./restore-state";
import { getTodo } from "./service";
import { entities } from "./store";

/** Definitions sync; the native app keeps permissions and scheduling state local. */
export function todoReminderSchedule() {
	const pausedForRestore = todosNeedRestoreReview();
	const reminders = pausedForRestore
		? []
		: entities("todo").flatMap((record) => {
				if (!record.fields.createdAt) return [];
				const todo = getTodo(record.id);
				if (todo.deleted || todo.state.status !== "open") return [];
				return todo.reminders.flatMap((reminder) => {
					const due = todo.due?.time ? dueInstant(todo.due) : null;
					const at =
						reminder.snoozedUntil ??
						reminder.at ??
						(due && reminder.offsetMinutes !== null
							? new Date(
									due.getTime() - reminder.offsetMinutes * 60000,
								).toISOString()
							: null);
					return at
						? [
								{
									todoId: todo.id,
									occurrenceId: todo.occurrenceId,
									sequence: todo.sequence,
									reminderId: reminder.id,
									title: todo.title,
									at,
								},
							]
						: [];
				});
			});
	return { pausedForRestore, reminders, generatedAt: new Date().toISOString() };
}
