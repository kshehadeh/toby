import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import type { LanguageModelMiddleware } from "ai";
import { recordGenerateCall, recordStreamCall } from "./session";

export function createRecordMiddleware(): LanguageModelMiddleware {
	return {
		specificationVersion: "v3",
		wrapGenerate: async ({ doGenerate, params }) => {
			const result = await doGenerate();
			recordGenerateCall(params, result);
			return result;
		},
		wrapStream: async ({ doStream, params }) => {
			const streamResult = await doStream();
			const chunks: LanguageModelV3StreamPart[] = [];
			const recordedStream = streamResult.stream.pipeThrough(
				new TransformStream<
					LanguageModelV3StreamPart,
					LanguageModelV3StreamPart
				>({
					transform(chunk, controller) {
						chunks.push(chunk);
						controller.enqueue(chunk);
					},
					flush() {
						recordStreamCall(params, chunks);
					},
				}),
			);
			return {
				...streamResult,
				stream: recordedStream,
			};
		},
	};
}
