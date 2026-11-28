# Changelog

All notable changes to AutoComm are documented here.

## Unreleased

- Increased the advisor response budget from 1,024 to 4,096 tokens for reasoning models. Incomplete replies now distinguish token-limit failures from provider errors and include the provider's error message when available.
- The advisor can be any model Pi has credentials for, including OpenRouter, GitHub Copilot, Anthropic, and OpenAI. The model menu only lists providers with configured authentication.
- Bare `/autocomm` now has a focused menu for starting a task, changing the advisor, stopping or resuming a review, and turning auto off. Removed the ask and file-sharing menu entries.
- `/autocomm stop` aborts an idle request as well as a pending task review. `/autocomm resume` starts a new review cycle without changing Pi's model.
- Public command forms are limited to `auto on`, `auto off`, `stop`, `resume`, and `status`; unsupported legacy forms now show usage.
