#include "whisper_bridge.h"

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "whisper.h"

namespace {

void whisper_log_silent(enum ggml_log_level, const char *, void *) {
}

char *dup_cstr(const std::string &value) {
	char *out = static_cast<char *>(std::malloc(value.size() + 1));
	if (out == nullptr) {
		return nullptr;
	}
	std::memcpy(out, value.data(), value.size());
	out[value.size()] = '\0';
	return out;
}

void set_error(char **error_out, const std::string &message) {
	if (error_out == nullptr) {
		return;
	}
	*error_out = dup_cstr(message);
}

std::string json_escape(const char *text) {
	if (text == nullptr) {
		return "";
	}
	std::string out;
	out.reserve(std::strlen(text) + 8);
	for (const unsigned char *cursor = reinterpret_cast<const unsigned char *>(text); *cursor != '\0'; ++cursor) {
		const unsigned char ch = *cursor;
		switch (ch) {
		case '"':
			out += "\\\"";
			break;
		case '\\':
			out += "\\\\";
			break;
		case '\n':
			out += "\\n";
			break;
		case '\r':
			out += "\\r";
			break;
		case '\t':
			out += "\\t";
			break;
		default:
			if (ch < 0x20) {
				char buffer[7];
				std::snprintf(buffer, sizeof(buffer), "\\u%04x", ch);
				out += buffer;
			} else {
				out.push_back(static_cast<char>(ch));
			}
			break;
		}
	}
	return out;
}

bool read_chunk_id(FILE *fp, char out[4]) {
	return std::fread(out, 1, 4, fp) == 4;
}

bool read_u32(FILE *fp, uint32_t &value) {
	return std::fread(&value, sizeof(value), 1, fp) == 1;
}

bool read_u16(FILE *fp, uint16_t &value) {
	return std::fread(&value, sizeof(value), 1, fp) == 1;
}

bool read_wav_mono_float(const char *wav_path, std::vector<float> &pcmf32, std::string &error) {
	FILE *fp = std::fopen(wav_path, "rb");
	if (fp == nullptr) {
		error = std::string("Could not open WAV file: ") + wav_path;
		return false;
	}

	char riff[4];
	char wave[4];
	uint32_t chunk_size = 0;
	if (!read_chunk_id(fp, riff) || std::strncmp(riff, "RIFF", 4) != 0 || !read_u32(fp, chunk_size) ||
		!read_chunk_id(fp, wave) || std::strncmp(wave, "WAVE", 4) != 0) {
		std::fclose(fp);
		error = "Invalid WAV header";
		return false;
	}

	uint16_t audio_format = 0;
	uint16_t channels = 0;
	uint32_t sample_rate = 0;
	uint16_t bits_per_sample = 0;
	long data_offset = -1;
	uint32_t data_size = 0;

	char chunk_id[4];
	while (read_chunk_id(fp, chunk_id)) {
		uint32_t subchunk_size = 0;
		if (!read_u32(fp, subchunk_size)) {
			break;
		}
		if (std::strncmp(chunk_id, "fmt ", 4) == 0) {
			read_u16(fp, audio_format);
			read_u16(fp, channels);
			read_u32(fp, sample_rate);
			uint32_t byte_rate = 0;
			uint16_t block_align = 0;
			read_u32(fp, byte_rate);
			read_u16(fp, block_align);
			read_u16(fp, bits_per_sample);
			const long consumed = 16;
			if (subchunk_size > static_cast<uint32_t>(consumed)) {
				std::fseek(fp, subchunk_size - consumed, SEEK_CUR);
			}
		} else if (std::strncmp(chunk_id, "data", 4) == 0) {
			data_offset = std::ftell(fp);
			data_size = subchunk_size;
			break;
		} else {
			std::fseek(fp, subchunk_size, SEEK_CUR);
		}
	}

	if (data_offset < 0 || data_size == 0) {
		std::fclose(fp);
		error = "WAV data chunk not found";
		return false;
	}
	if (audio_format != 1 || channels != 1 || sample_rate != 16000 || bits_per_sample != 16) {
		std::fclose(fp);
		error = "Expected 16 kHz mono PCM16 WAV audio";
		return false;
	}

	std::fseek(fp, data_offset, SEEK_SET);
	const size_t sample_count = data_size / 2;
	std::vector<int16_t> pcm16(sample_count);
	if (std::fread(pcm16.data(), sizeof(int16_t), sample_count, fp) != sample_count) {
		std::fclose(fp);
		error = "Could not read WAV PCM samples";
		return false;
	}
	std::fclose(fp);

	pcmf32.resize(sample_count);
	for (size_t i = 0; i < sample_count; ++i) {
		pcmf32[i] = static_cast<float>(pcm16[i]) / 32768.0f;
	}
	return true;
}

} // namespace

char *whisper_bridge_transcribe_wav_json(
	const char *model_path,
	const char *wav_path,
	const char *language,
	char **error_out) {
	if (error_out != nullptr) {
		*error_out = nullptr;
	}
	if (model_path == nullptr || model_path[0] == '\0') {
		set_error(error_out, "model_path is required");
		return nullptr;
	}
	if (wav_path == nullptr || wav_path[0] == '\0') {
		set_error(error_out, "wav_path is required");
		return nullptr;
	}

	std::vector<float> pcmf32;
	std::string error;
	if (!read_wav_mono_float(wav_path, pcmf32, error)) {
		set_error(error_out, error);
		return nullptr;
	}

	whisper_log_set(whisper_log_silent, nullptr);
	whisper_context_params cparams = whisper_context_default_params();
	cparams.use_gpu = false;
	whisper_context *ctx = whisper_init_from_file_with_params(model_path, cparams);
	if (ctx == nullptr) {
		set_error(error_out, std::string("Could not load whisper model: ") + model_path);
		return nullptr;
	}

	whisper_full_params wparams = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
	wparams.print_progress = false;
	wparams.print_realtime = false;
	wparams.print_timestamps = false;
	wparams.translate = false;
	wparams.no_timestamps = false;
	if (language != nullptr && language[0] != '\0' && std::strcmp(language, "auto") != 0) {
		wparams.language = language;
	} else {
		wparams.language = "auto";
	}

	const int rc = whisper_full(ctx, wparams, pcmf32.data(), static_cast<int>(pcmf32.size()));
	if (rc != 0) {
		whisper_free(ctx);
		set_error(error_out, "whisper_full failed");
		return nullptr;
	}

	const int segment_count = whisper_full_n_segments(ctx);
	std::string json = "{\"text\":\"";
	std::string full_text;
	std::string segments_json = "[";

	for (int i = 0; i < segment_count; ++i) {
		const char *segment_text = whisper_full_get_segment_text(ctx, i);
		const int64_t t0 = whisper_full_get_segment_t0(ctx, i);
		const int64_t t1 = whisper_full_get_segment_t1(ctx, i);
		const double start = static_cast<double>(t0) * 0.01;
		const double end = static_cast<double>(t1) * 0.01;
		if (!full_text.empty()) {
			full_text.push_back(' ');
		}
		if (segment_text != nullptr) {
			full_text += segment_text;
		}
		if (i > 0) {
			segments_json += ",";
		}
		char time_buffer[64];
		std::snprintf(time_buffer, sizeof(time_buffer), "{\"start\":%.3f,\"end\":%.3f,\"text\":\"", start, end);
		segments_json += time_buffer;
		segments_json += json_escape(segment_text);
		segments_json += "\"}";
	}

	json += json_escape(full_text.c_str());
	json += "\",\"transcription\":";
	json += segments_json;
	json += "]}";

	whisper_free(ctx);
	return dup_cstr(json);
}

void whisper_bridge_free_string(char *value) {
	std::free(value);
}
