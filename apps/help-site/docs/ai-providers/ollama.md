---
sidebar_position: 6
title: Ollama
---

# <span class="ai-provider-title"><img class="ai-provider-icon" src="/img/ai-providers/ollama.png" alt="" width="40" height="40" />Ollama</span>

[Ollama](https://ollama.com/) runs open-source models locally on your Mac (or another machine you control). Personas that use the **ollama** provider talk to Ollama’s OpenAI-compatible HTTP API with **local model names**, for example `llama3.2` or `mistral`.

No cloud API key is required for the default local install.

## Install and run Ollama

1. Download and install Ollama from [ollama.com](https://ollama.com/).
2. Start Ollama (the menu bar app or `ollama serve`).
3. Pull a model, for example:

```bash
ollama pull llama3.2
```

4. Confirm the local API is up (default: `http://localhost:11434`).

## Configure in Toby

Open **Toby.app → Settings → AI → Ollama**:

1. Set **Base URL** to your Ollama OpenAI-compatible endpoint (Toby defaults to `http://localhost:11434/v1`).
2. Leave **API Key** empty unless your Ollama instance requires one.

For a persona, set **AI Provider** to `ollama` and choose a model you have pulled (or type a model name Ollama knows).

## Tips

- Model ids match `ollama list` names (for example `llama3.2`, not a cloud slug).
- If Ollama runs on another host, point **Base URL** at that machine’s reachable address and ensure the port is open.
- For more context on choosing providers, see [AI providers overview](./overview).
