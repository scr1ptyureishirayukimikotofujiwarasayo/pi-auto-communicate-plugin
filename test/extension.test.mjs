import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import autocomm from '../extension.ts';

const advisorA = { id: 'example/advisor-a', provider: 'openrouter' };
const advisorB = { id: 'example/advisor-b', provider: 'openrouter' };
const advisorC = { id: 'gpt-5.2', provider: 'github-copilot' };

function setup(cwd = process.cwd()) {
  const events = new Map();
  const calls = [];
  const plans = [];
  const sent = [];
  const notices = [];
  const selections = [];
  let command;
  const state = { choose: undefined };
  const ctx = {
    cwd,
    hasUI: true,
    ui: {
      setStatus() {},
      notify: (message) => notices.push(message),
      select: (title, choices) => {
        selections.push({ title, choices });
        return Promise.resolve(state.choose ? state.choose(title, choices) : undefined);
      },
    },
    hasPendingMessages: () => false,
    modelRegistry: {
      find: (provider, id) => [advisorA, advisorB, advisorC].find(m => m.provider === provider && m.id === id),
      getAvailable: () => [advisorA, advisorB, advisorC],
      hasConfiguredAuth: () => true,
      streamSimple(model, context, options) {
        calls.push({ model, context, options });
        const text = plans.shift() ?? 'DONE';
        return { result: () => typeof text === 'function'
          ? text(options.signal)
          : Promise.resolve({ stopReason: 'stop', content: [{ type: 'text', text }] }) };
      },
    },
  };
  autocomm({
    on: (name, handler) => events.set(name, handler),
    sendUserMessage: (text) => sent.push(text),
    registerCommand(name, registration) {
      assert.equal(name, 'autocomm');
      command = registration.handler;
    },
  });

  return {
    calls,
    plans,
    sent,
    notices,
    selections,
    get choose() { return state.choose; },
    set choose(handler) { state.choose = handler; },
    events,
    command: args => command(args, ctx),
    start: prompt => events.get('before_agent_start')({ messageType: 'user', prompt }, ctx),
    settle: () => events.get('agent_before_settle')({
      outcome: 'completed',
      entries: [],
      context: {
        pendingMessages: [],
        llmMessages: [{ role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Pi replied.' }] }],
      },
    }, ctx),
  };
}

test('starts disabled, then forwards one short suggestion and stops at DONE', async () => {
  const app = setup();
  await app.command(`model ${advisorA.id}`);
  app.start('Verify the greeting.');
  assert.equal(await app.settle(), undefined);
  assert.equal(app.calls.length, 0);

  await app.command('on');
  app.plans.push('Run the greeting unit test.', 'DONE');
  const result = await app.settle();
  assert.equal(result.continue, true);
  assert.equal(result.entries[0].display, true);
  assert.match(result.entries[0].content, /AutoComm advisor suggestion: Run the greeting unit test\./);
  const first = app.calls[0];
  assert.equal(first.model, advisorA);
  assert.equal(first.options.toolChoice, 'none');
  assert.equal(first.context.messages.length, 1);
  assert.deepEqual(JSON.parse(first.context.messages[0].content), {
    phase: 'review', goal: 'Verify the greeting.', latestReply: 'Pi replied.', previousAdvice: [], workspaceFiles: [],
  });
  assert.equal(await app.settle(), undefined);
  assert.deepEqual(JSON.parse(app.calls[1].context.messages[0].content).previousAdvice, ['Run the greeting unit test.']);
});

test('switches advisor models and caps follow-ups at three per task', async () => {
  const app = setup();
  await app.command(`model ${advisorA.id}`);
  await app.command('on');
  app.start('Review the greeting.');
  app.plans.push('Check one.', 'Check two.', 'Check three.', 'Check four.');
  assert.equal((await app.settle()).continue, true);
  await app.command(`model ${advisorB.id}`);
  assert.equal((await app.settle()).continue, true);
  assert.equal((await app.settle()).continue, true);
  assert.equal(await app.settle(), undefined);
  assert.deepEqual(app.calls.map(call => call.model), [advisorA, advisorB, advisorB]);
});

test('disabling the advisor cancels a pending request without forwarding advice', async () => {
  const app = setup();
  await app.command(`model ${advisorA.id}`);
  await app.command('on');
  app.start('Check cancellation.');
  app.plans.push(() => new Promise(() => {}));
  const pending = app.settle();
  const { signal } = app.calls[0].options;
  await app.command('off');
  assert.equal(signal.aborted, true);
  assert.equal(await pending, undefined);
});

test('auto mode kicks off before Pi replies and reviews fresh excerpts of shared files only', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'autocomm-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const cwd = join(base, 'workspace');
  await mkdir(cwd);
  const path = 'hello world.ts';
  const file = join(cwd, path);
  const initial = 'export const greeting = "hello";';
  await writeFile(file, initial);
  await writeFile(join(cwd, 'unshared.ts'), 'not shared');
  await writeFile(join(cwd, 'credentials.json'), '{}');
  await writeFile(join(base, 'outside.ts'), 'outside');

  const app = setup(cwd);
  await app.command(`model ${advisorA.id}`);
  await app.command(`share ${path}`);
  await app.command('share credentials.json');
  await app.command('share ../outside.ts');
  await app.command('auto');
  app.plans.push('Update the greeting.', 'Verify the greeting.', 'DONE');
  const kickoff = await app.start('Change the greeting.');
  assert.match(kickoff.message.content, /Update the greeting/);
  assert.deepEqual(JSON.parse(app.calls[0].context.messages[0].content), {
    phase: 'kickoff', goal: 'Change the greeting.', latestReply: '', previousAdvice: [],
    workspaceFiles: [{ path, content: initial, truncated: false }],
  });

  await writeFile(file, 'x'.repeat(4095) + '😀');
  assert.equal((await app.settle()).continue, true);
  const checkpoint = JSON.parse(app.calls[1].context.messages[0].content);
  assert.equal(checkpoint.phase, 'checkpoint');
  assert.equal(checkpoint.latestReply, 'Pi replied.');
  assert.deepEqual(checkpoint.previousAdvice, ['Update the greeting.']);
  assert.deepEqual(checkpoint.workspaceFiles, [{ path, content: 'x'.repeat(4095), truncated: true }]);
  await app.command(`unshare ${path}`);
  assert.equal(await app.settle(), undefined);
  assert.deepEqual(JSON.parse(app.calls[2].context.messages[0].content).workspaceFiles, []);
});

test('auto mode caps follow-ups and falls back to an ordinary run if kickoff returns DONE', async () => {
  const app = setup();
  await app.command(`model ${advisorA.id}`);
  await app.command('auto');
  assert.equal(await app.start('No kickoff needed.'), undefined);
  assert.equal(await app.settle(), undefined);
  assert.equal(app.calls.length, 1);

  app.plans.push(...Array.from({ length: 10 }, (_, index) => `Check item ${index}.`));
  assert.match((await app.start('Check the items.')).message.content, /Check item 0/);
  for (let i = 0; i < 8; i++) assert.equal((await app.settle()).continue, true);
  assert.equal(await app.settle(), undefined);
  assert.equal(app.calls.length, 10);
});

test('selecting a model with /autocomm model does not print a usage error', async () => {
  const app = setup();
  await app.command(`model ${advisorA.id}`);
  assert.ok(app.notices.every((notice) => !/^Usage:/.test(notice)));
  assert.ok(app.notices.some((notice) => notice.includes(advisorA.id)));
});

test('advisor can be any configured provider, selected as provider/id', async () => {
  const app = setup();
  await app.command(`model ${advisorC.provider}/${advisorC.id}`); // github-copilot/gpt-5.2, no internal slash
  await app.command('on');
  app.start('Draft the change.');
  app.plans.push('Check the test matrix.', 'DONE');
  assert.equal((await app.settle()).continue, true);
  assert.equal(app.calls[0].model, advisorC, 'streamed on a non-OpenRouter provider');
});

test('a double-colon disambiguates provider for ids that contain slashes', async () => {
  const app = setup();
  await app.command('model openrouter::example/advisor-a');
  await app.command('on');
  app.start('Verify the greeting.');
  app.plans.push('Check one.', 'DONE');
  await app.settle();
  assert.equal(app.calls[0].model, advisorA, 'resolved provider=openrouter, id=example/advisor-a');
});

test('a quoted task sets the goal and launches with a kickoff instead of a usage error', async () => {
  const app = setup();
  await app.command(`model ${advisorA.id}`);
  await app.command('on');
  app.plans.push('Add a test for the change.');
  await app.command('Build a deterministic greeting and add a unit test for it.');
  assert.equal(app.sent.length, 1);
  assert.match(app.sent[0], /AutoComm advisor suggestion: Add a test for the change\./);
  assert.deepEqual(JSON.parse(app.calls[0].context.messages[0].content), {
    phase: 'kickoff', goal: 'Build a deterministic greeting and add a unit test for it.', latestReply: '', previousAdvice: [], workspaceFiles: [],
  });
});

test('a launched task keeps its own goal across follow-up reviews, not the injected prompt', async () => {
  const app = setup();
  await app.command(`model ${advisorA.id}`);
  await app.command('auto');
  app.plans.push('First milestone.', 'Second milestone.');
  await app.command('Refactor the parser.');
  assert.equal(app.calls[0].context.messages[0].content.includes('Refactor the parser.'), true);
  // The injected user message starts a run; it must not be re-read as a new goal.
  assert.equal(await app.start('AutoComm advisor suggestion: First milestone.'), undefined);
  const result = await app.settle();
  assert.equal(result.continue, true);
  assert.equal(JSON.parse(app.calls[1].context.messages[0].content).goal, 'Refactor the parser.');
});

test('an unknown /autocomm subcommand form still shows usage only for bare noise', async () => {
  const app = setup();
  // Empty /autocomm behaves like status and never claims a launch.
  assert.equal(await app.command(''), undefined);
  assert.equal(app.sent.length, 0);
});

test('bare /autocomm opens a menu offering every subcommand', async () => {
  const app = setup();
  await app.command('');
  assert.equal(app.selections.length, 1);
  assert.match(app.selections[0].title, /AutoComm/);
  assert.deepEqual(app.selections[0].choices, [
    'On \u2014 Pi leads, advisor reviews replies',
    'Auto \u2014 advisor leads each task',
    'Off',
    'Change advisor model',
    'Share a file',
    'Unshare all files',
    'Show status',
  ]);
});

test('choosing On in the menu enables the advisor and keeps the goal on later reviews', async () => {
  const app = setup();
  await app.command(`model ${advisorA.id}`);
  app.choose = () => 'On \u2014 Pi leads, advisor reviews replies';
  await app.command('');
  app.start('Greet the reviewer.');
  app.plans.push('Run the test.', 'DONE');
  const result = await app.settle();
  assert.equal(result.continue, true);
  assert.equal(JSON.parse(app.calls[0].context.messages[0].content).phase, 'review');
});

test('choosing Show status in the menu routes to the status subcommand', async () => {
  const app = setup();
  app.choose = () => 'Show status';
  await app.command('');
  assert.equal(app.selections.length, 1);
  assert.match(app.notices.at(-1), /AutoComm off \| Advisor: not selected/);
});
