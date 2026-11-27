# AutoComm for Pi

AutoComm lets a separate OpenRouter model review Pi's replies and selected workspace files and suggest one milestone at a time. Pi keeps its current coding model and handles the work. In auto mode, the advisor proposes the first milestone before Pi starts.

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

Authenticate with `/login openrouter` or set `OPENROUTER_API_KEY` before launching Pi. Run `/autocomm model` to pick an advisor. To have it lead from the start, launch Pi in the project directory and use:

```text
/autocomm share src/greeting.ts
/autocomm auto
Add an option for a custom greeting in src/greeting.ts and verify it with tests.
```

The advisor sees the goal and any shared file excerpts before Pi starts. At each checkpoint it receives Pi's latest reply and fresh excerpts, and can propose the next milestone. Sharing is optional; AutoComm doesn't scan your workspace or automatically share files mentioned in a prompt.

| Command | Effect |
| --- | --- |
| `/autocomm model` | Open the OpenRouter model picker. |
| `/autocomm model <id>` | Select or switch advisors without changing Pi's coding model. |
| `/autocomm on` | Let Pi start on its own, then review its replies for up to three follow-ups. |
| `/autocomm auto` | Start the next task with advisor guidance and allow up to eight follow-ups. |
| `/autocomm off` | Disable the advisor and cancel any in-flight advisor request. Pi's current work continues. |
| `/autocomm share <path>` | Include a workspace-relative text file in future advisor calls this session. Use `/` in paths. |
| `/autocomm unshare [path]` | Remove one shared path, or clear the list if no path is given. This cannot retract data already sent. |
| `/autocomm status` | Show the mode, advisor, follow-up limit, and shared paths. |

AutoComm starts off. When enabled, it sends excerpts of your task and Pi's latest reply, previous advisor suggestions for that task, and the first 4 KiB of up to six explicitly shared files to OpenRouter. Suggestions show up in the session. The loop stops at `DONE` or at the follow-up limit. If auto mode gets no usable kickoff advice, Pi handles the prompt normally without advisor follow-ups. Advisor requests can incur separate OpenRouter charges. **Excerpts are not redacted**; don't share files, prompts, or replies containing secrets.

## Develop

Run `npm test` with Node.js 22.19 or newer. The tests use mocked model responses and don't need an OpenRouter account or API key.
