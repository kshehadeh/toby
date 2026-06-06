/** Human-readable labels for common cron expressions (display only). */
export function cronToHuman(cronExpression: string): string {
	const common: Record<string, string> = {
		"* * * * *": "every minute",
		"*/5 * * * *": "every 5 minutes",
		"*/15 * * * *": "every 15 minutes",
		"*/30 * * * *": "every 30 minutes",
		"0 * * * *": "every hour",
		"0 */2 * * *": "every 2 hours",
		"0 */6 * * *": "every 6 hours",
		"0 9 * * *": "every day at 9am",
		"0 9 * * 1-5": "every weekday at 9am",
		"0 9 * * 1": "every Monday at 9am",
		"0 9 1 * *": "monthly on the 1st at 9am",
	};

	const human = common[cronExpression.trim()];
	if (human) return human;

	const parts = cronExpression.trim().split(/\s+/);
	if (parts.length !== 5) return cronExpression;
	return cronExpression;
}
