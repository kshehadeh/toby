/** Plain-text fallback for Slack notifications (no mrkdwn). */
export function slackStatusPlainFallback(mrkdwnLine: string): string {
	return mrkdwnLine
		.replace(/\\_/g, "_")
		.replace(/_/g, "")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.trim();
}
