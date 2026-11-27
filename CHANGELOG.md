# Changelog

All notable changes to AutoComm are documented here.

## Unreleased

- Bare `/autocomm` now opens an interactive menu (on, auto, off, change advisor, share a file, unshare, show status) instead of only printing a status line. In non-interactive runs it still reports status.
- Fixed a regression where `/autocomm model <id>` or `/autocomm on` with no active task fell through to the task launcher and printed a spurious usage warning. These subcommands now run their action and return.
