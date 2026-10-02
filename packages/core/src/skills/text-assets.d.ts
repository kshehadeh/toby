/** Bun embeds these imports when used with the text loader. */
declare module "*.md" {
	const text: string;
	export default text;
}
