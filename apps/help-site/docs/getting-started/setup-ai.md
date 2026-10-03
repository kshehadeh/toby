---
sidebar_position: 2
title: Set up your AI
---

# Set up your AI

Toby needs an AI provider to understand your requests and write answers. Think
of the provider as Toby's "brain": you create an account with the provider,
and Toby uses it on your behalf. You only need **one**.

## Quickest path: OpenRouter (recommended)

[OpenRouter](../ai-providers/openrouter) gives you access to models from
OpenAI, Anthropic, Google, and others through one account. You sign in from
your browser, so there's no key to copy and paste.

1. On **Home**, find the setup checklist and click **Connect** next to
   **Configure AI provider**. You can also go to
   **Settings → AI → OpenRouter → Guided setup**.
2. Keep **OpenRouter · Recommended** selected and click **Connect OpenRouter**.
3. Your browser opens. Sign in or create an OpenRouter account, then approve
   access for Toby.
4. Return to Toby. It sends a short test message, saves the connection
   securely, and picks a good everyday model for you.

When you see **Ready**, try asking: "Help me plan my day."

:::tip What does it cost?
You pay the provider for what you use, usually a fraction of a cent per
message for everyday models. Add a few dollars of credit to start. Toby shows
your spend under **Settings → AI → [provider] → Plan Usage**, and tells you if
your account runs out of credit.
:::

## Other options

![Settings → AI lists every supported provider and whether it is connected](/img/toby-app-settings-ai.png)

| Provider | Choose it if you… |
| -------- | ----------------- |
| [OpenRouter](../ai-providers/openrouter) | Want the easiest setup and lots of model choices (recommended) |
| [Vercel AI Gateway](../ai-providers/vercel-ai-gateway) | Want one key that also unlocks Toby's web search and extra transcription options |
| [OpenAI](../ai-providers/openai) | Already have an OpenAI API account |
| [Chutes](../ai-providers/chutes) | Prefer open-source models run in secure hardware |
| [Ollama](../ai-providers/ollama) | Want everything to run on your own Mac, with no account (needs a powerful Mac) |

To use one of these, open **Settings → AI**, click the provider, and paste
your key. Each provider's page explains where to get a key. Vercel AI Gateway
also has a **Guided setup**.

![Vercel AI Gateway settings with a saved API key](/img/toby-app-settings-vercel.png)

## Change the model (optional)

The AI model is part of a [persona](../personas). To change it, open
**Settings → Personas**, pick a persona (for example **Toby**), and open the
**Model** tab:

![The Model tab of a persona, with Provider and Model pickers](/img/toby-app-settings-persona.png)

Most people never need to change this. If you want to experiment, a common
setup is a fast, inexpensive model for everyday questions and a larger model
in a second persona for long writing.

## Next step

[Connect your apps →](./configure-and-status)
