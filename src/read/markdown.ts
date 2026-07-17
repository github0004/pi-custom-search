/** HTML → markdown via turndown + GFM. */

import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

export function normalizeWhitespace(text: string): string {
	if (!/[\r\t]| \n|\n |\n{3,}| {2}/u.test(text)) {
		return text.trim();
	}
	return text
		.replaceAll(/\r\n?/gu, "\n")
		.replaceAll(/[\t ]+/gu, " ")
		.replaceAll(/ *\n */gu, "\n")
		.replaceAll(/\n{3,}/gu, "\n\n")
		.trim();
}

export interface MarkdownOptions {
	removeImages?: boolean;
}

function createMarkdownService(removeImages: boolean): TurndownService {
	const turndown = new TurndownService({
		codeBlockStyle: "fenced",
		headingStyle: "atx",
		bulletListMarker: "-",
		emDelimiter: "_",
		strongDelimiter: "**",
	});
	turndown.use(gfm);
	turndown.remove(["script", "style", "noscript", "template"]);
	if (removeImages) {
		turndown.addRule("removeImages", { filter: "img", replacement: () => "" });
	}
	turndown.addRule("stableLinks", {
		filter: "a",
		replacement: (content, node) => {
			const href = (node as HTMLAnchorElement).getAttribute?.("href");
			if (!href) return content;
			const label = content.trim().replaceAll(/\s+/gu, " ");
			return label ? `[${label}](${href})` : href;
		},
	});
	return turndown;
}

const keepImagesService = createMarkdownService(false);
const removeImagesService = createMarkdownService(true);

function stripLargeElements(html: string): string {
	if (html.length < 40_000) return html;
	const hasTable = html.includes("<table");
	const hasList = html.includes("<ul") || html.includes("<ol");
	if (!hasTable && !hasList) return html;
	let trCount = 0;
	let liCount = 0;
	if (hasTable) {
		trCount = html.match(/<tr[\s>]/giu)?.length ?? 0;
	}
	if (hasList) {
		liCount = html.match(/<li[\s>]/giu)?.length ?? 0;
	}
	if (trCount < 20 && liCount < 100) return html;
	let result = html;
	if (trCount >= 20) {
		result = result.replaceAll(/<table[\s\S]*?<\/table>/giu, "\n\n");
	}
	if (liCount >= 100) {
		result = result.replaceAll(/<(ul|ol)[\s\S]*?<\/(ul|ol)>/giu, "\n\n[Long list]\n\n");
	}
	return result;
}

export function htmlToMarkdown(html: string, options: MarkdownOptions = {}): string {
	const service = options.removeImages ? removeImagesService : keepImagesService;
	return normalizeWhitespace(service.turndown(stripLargeElements(html)));
}

/** Strip tags for plain text fallback. */
export function htmlToText(html: string): string {
	return normalizeWhitespace(
		html
			.replace(/<script[\s\S]*?<\/script>/giu, " ")
			.replace(/<style[\s\S]*?<\/style>/giu, " ")
			.replace(/<[^>]+>/gu, " "),
	);
}
