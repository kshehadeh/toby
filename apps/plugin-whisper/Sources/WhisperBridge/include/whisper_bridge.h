#pragma once

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/// Transcribe a 16 kHz mono WAV file. Returns malloc'd UTF-8 JSON on success.
/// Caller must free with whisper_bridge_free_string(). On failure, writes an
/// error message to *error_out (also malloc'd) and returns NULL.
char *whisper_bridge_transcribe_wav_json(
	const char *model_path,
	const char *wav_path,
	const char *language,
	char **error_out);

void whisper_bridge_free_string(char *value);

#ifdef __cplusplus
}
#endif
