# Changelog

All notable changes to AutoComm are documented here.

## Unreleased

- The advisor can now be any model Pi has credentials for, not just OpenRouter. Bare `/autocomm model` lists models across all configured providers, and `/autocomm model <provider/id>` (or `provider::id` for ids that contain slashes) selects one directly. Removing an advisor no longer forces you back through OpenRouter.
- Bare `/autocomm` now opens an interactive menu (on, auto, off, change advisor, share a file, unshare, show status) instead of only printing a status line. In non-interactive runs it still reports status.
- Fixed a regression where `/autocomm model <id>` or `/autocomm on` with no active task fell through to the task launcher and printed a spurious usage warning. These subcommands now run their action and return.
