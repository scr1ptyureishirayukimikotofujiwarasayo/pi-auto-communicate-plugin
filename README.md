# AutoComm for Pi

AutoComm lets a separate advisor model review Pi's replies and selected workspace files and suggest one milestone at a time. The advisor can be any model you have credentials for — OpenRouter, GitHub Copilot, Anthropic, OpenAI, or any provider Pi supports — while Pi keeps its own coding model and handles the work. In auto mode, the advisor proposes the first milestone before Pi starts.

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

AutoComm starts **off** and does nothing until you start a task or enable auto mode. It initially uses Pi's current model as the advisor. Open bare `/autocomm` to start a task, choose a different advisor, stop the current review, resume a review, or turn auto off. Use `/autocomm auto` for an on/off selector. Changing the advisor never changes Pi's coding model or session. Use `/login <provider>` first if the selected provider needs credentials.

Only these public command forms are supported:

| Command | Effect |
| --- | --- |
| `/autocomm` | Open the configuration and task menu. In a non-interactive run, show status. |
| `/autocomm <task>` | Enable auto mode, ask the advisor for the first milestone, and start Pi on this task immediately. |
| `/autocomm auto` | Open the auto on/off selector. In a non-interactive run, show usage. |
| `/autocomm auto on` | Enable auto mode without starting a task. Your next ordinary prompt is the goal. |
| `/autocomm auto off` | Disable AutoComm and cancel its pending advisor request. Pi's current work continues. |
| `/autocomm stop` | Abort the current review request without disabling auto mode. |
| `/autocomm resume` | Prompt for a goal and start a new advisor review cycle. |
| `/autocomm status` | Show the advisor, phase, and next-review status. |

To start from the menu, choose **Start auto task** and enter the goal. The other menu actions change the advisor, stop or resume a review, and turn auto off.

For example:

```text
/autocomm Build a deterministic greeting function and add a unit test for it.
```

Alternatively, run `/autocomm auto on` (or select **Turn auto on** through `/autocomm auto`) and then enter your task as an ordinary Pi prompt. AutoComm uses that first prompt as the goal and gives Pi the advisor's initial instruction. After each completed Pi reply, it automatically sends the next instruction until the advisor replies `DONE`, repeats advice, encounters an error, or you stop it.

The advisor sees the goal before Pi starts. At each checkpoint it receives Pi's latest reply, then proposes one milestone or replies `DONE`. If kickoff for an ordinary prompt produces no usable advice, Pi handles that prompt normally without advisor follow-ups; a direct or menu-started task does not start without usable advice.

The status line is explicit: `AutoComm off`, `AutoComm idle`, or `AutoComm consulting <provider/model>`. Model selection alone does not enable the loop. AutoComm sends task and reply excerpts and previous advice to the advisor provider. Requests can incur separate charges. **Excerpts are not redacted**; do not include secrets in tasks or replies.

## Develop

Run `npm test` with Node.js 22.19 or newer. The tests use mocked model responses and don't need any provider credentials or API keys.
