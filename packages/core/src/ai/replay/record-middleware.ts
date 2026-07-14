import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import type { LanguageModelMiddleware } from "ai";
import { recordGenerateCall, recordStreamCall } from "./session";

export function createRecordMiddleware(): LanguageModelMiddleware {
	return {
		specificationVersion: "v4",
		wrapGenerate: async ({ doGenerate, params }) => {
			const result = await doGenerate();
			recordGenerateCall(params, result);
			return result;
		},
		wrapStream: async ({ doStream, params }) => {
			const streamResult = await doStream();
			const chunks: LanguageModelV4StreamPart[] = [];
			const recordedStream = streamResult.stream.pipeThrough(
				new TransformStream<
					LanguageModelV4StreamPart,
					LanguageModelV4StreamPart
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
