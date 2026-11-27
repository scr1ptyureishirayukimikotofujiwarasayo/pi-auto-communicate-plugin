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

AutoComm starts **off** and does nothing until you enable auto mode. It initially uses Pi's current model as the advisor. Open bare `/autocomm` to start a task, enable or disable auto mode, choose a different advisor, share files, or show status. Changing the advisor never changes Pi's coding model or session. Use `/login <provider>` first if the selected provider needs credentials.

Only these public command forms are supported:

| Command | Effect |
| --- | --- |
| `/autocomm` | Open the configuration and task menu. In a non-interactive run, show status. |
| `/autocomm auto on [task]` | Enable auto mode. With a task, ask the advisor for the first milestone and start Pi immediately. |
| `/autocomm auto off` | Disable AutoComm and cancel its pending advisor request. Pi's current work continues. |

To start from the menu, choose **Start auto task** and enter the goal. To configure sharing, choose **Share a file**, **Unshare a file**, or **Unshare all files**. Sharing is optional and limited to workspace-relative text files.

For example:

```text
/autocomm auto on Build a deterministic greeting function and add a unit test for it.
```

The advisor sees the goal and shared excerpts before Pi starts. At each checkpoint it receives Pi's latest reply and fresh excerpts, then proposes one milestone or replies `DONE`. The loop allows up to eight follow-ups. If kickoff produces no usable advice, Pi handles the original prompt normally without advisor follow-ups.

The status line is explicit: `AutoComm off`, `AutoComm idle`, or `AutoComm consulting <provider/model>`. Model selection alone does not enable the loop. AutoComm sends task and reply excerpts, previous advice, and the first 4 KiB of up to six explicitly shared files to the advisor provider. Requests can incur separate charges. **Excerpts are not redacted**; do not share secrets.

## Develop

Run `npm test` with Node.js 22.19 or newer. The tests use mocked model responses and don't need any provider credentials or API keys.
