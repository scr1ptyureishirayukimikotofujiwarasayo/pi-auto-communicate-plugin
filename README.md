# AutoComm for Pi

AutoComm lets a separate OpenRouter model review Pi's replies and suggest one short next step at a time. Pi keeps its current coding model and handles the work. Tested with Pi 1.6.1.

## Install

Install directly from GitHub as a Pi package:

```bash
pi install git:github.com/scr1ptyureishirayukimikotofujiwarasayo/pi-auto-communicate-plugin
```

To try a local checkout without installing it, run this from the checkout directory:

```bash
pi -e ./extension.ts
```

## Use

Authenticate with `/login openrouter` or set `OPENROUTER_API_KEY` before launching Pi. Then run `/autocomm model` to pick an advisor, `/autocomm on` to enable it, and enter a normal task.

| Command | Effect |
| --- | --- |
| `/autocomm model` | Open the OpenRouter model picker. |
| `/autocomm model <id>` | Select or switch advisors without changing Pi's coding model. |
| `/autocomm on` | Enable the advisor for this session. |
| `/autocomm off` | Disable the advisor and cancel any in-flight advisor request. Pi's current work continues. |
| `/autocomm status` | Show whether the advisor is enabled and which model is selected. |

AutoComm starts off. When enabled, it sends excerpts of your task and Pi's latest reply, plus previous advisor suggestions for that task, to OpenRouter. Suggestions show up in the session. The loop stops when the advisor replies `DONE` or after three follow-ups. Advisor requests can incur separate OpenRouter charges. Keep secrets out of task text and replies; excerpts are not redacted.

## Develop

Run `npm test` with Node.js 22.19 or newer. The tests use mocked model responses and don't need an OpenRouter account or API key.
