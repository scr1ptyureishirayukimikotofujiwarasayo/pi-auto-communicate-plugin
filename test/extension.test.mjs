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
  const state = { choose: undefined, input: undefined };
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
      input: () => Promise.resolve(state.input),
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
    set input(value) { state.input = value; },
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

async function selectModel(app, advisor) {
  app.choose = (title, choices) => title.startsWith('Advisor model')
    ? choices.find(choice => choice.startsWith(`${advisor.provider}/${advisor.id}`))
    : 'Change advisor model';
  await app.command('');
  app.choose = undefined;
}

async function menuInput(app, choice, input) {
  app.choose = () => choice;
  app.input = input;
  await app.command('');
  app.choose = undefined;
  app.input = undefined;
}

test('starts disabled, then auto mode forwards suggestions and stops at DONE', async () => {
  const app = setup();
  await selectModel(app, advisorA);
  await app.start('Verify the greeting.');
  assert.equal(await app.settle(), undefined);
  assert.equal(app.calls.length, 0);

  await app.command('auto on');
  app.plans.push('Run the greeting unit test.', 'Check the result.', 'DONE');
  const kickoff = await app.start('Verify the greeting.');
  assert.match(kickoff.message.content, /Run the greeting unit test\./);
  const result = await app.settle();
  assert.equal(result.continue, true);
  assert.equal(result.entries[0].display, true);
  assert.match(result.entries[0].content, /AutoComm advisor suggestion: Check the result\./);
  const first = app.calls[0];
  assert.equal(first.model, advisorA);
  assert.equal(first.options.toolChoice, 'none');
  assert.equal(first.context.messages.length, 1);
  assert.deepEqual(JSON.parse(first.context.messages[0].content), {
    phase: 'kickoff', goal: 'Verify the greeting.', latestReply: '', previousAdvice: [], workspaceFiles: [],
  });
  assert.equal(await app.settle(), undefined);
  assert.deepEqual(JSON.parse(app.calls[1].context.messages[0].content).previousAdvice, ['Run the greeting unit test.']);
});

test('switches advisor models through the menu between automatic reviews', async () => {
  const app = setup();
  await selectModel(app, advisorA);
  await app.command('auto on');
  app.plans.push('Check one.', 'Check two.', 'DONE');
  await app.start('Review the greeting.');
  assert.equal((await app.settle()).continue, true);
  await selectModel(app, advisorB);
  assert.equal(await app.settle(), undefined);
  assert.deepEqual(app.calls.map(call => call.model), [advisorA, advisorA, advisorB]);
});

test('disabling the advisor cancels a pending request without forwarding advice', async () => {
  const app = setup();
  await selectModel(app, advisorA);
  await app.command('auto on');
  app.plans.push(() => new Promise(() => {}));
  const pending = app.start('Check cancellation.');
  const { signal } = app.calls[0].options;
  await app.command('auto off');
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
  await selectModel(app, advisorA);
  await menuInput(app, 'Share a file', path);
  await menuInput(app, 'Share a file', 'credentials.json');
  await menuInput(app, 'Share a file', '../outside.ts');
  await app.command('auto on');
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
  await menuInput(app, 'Unshare a file', path);
  assert.equal(await app.settle(), undefined);
  assert.deepEqual(JSON.parse(app.calls[2].context.messages[0].content).workspaceFiles, []);
});

test('auto mode caps follow-ups and falls back to an ordinary run if kickoff returns DONE', async () => {
  const app = setup();
  await selectModel(app, advisorA);
  await app.command('auto on');
  assert.equal(await app.start('No kickoff needed.'), undefined);
  assert.equal(await app.settle(), undefined);
  assert.equal(app.calls.length, 1);

  app.plans.push(...Array.from({ length: 10 }, (_, index) => `Check item ${index}.`));
  assert.match((await app.start('Check the items.')).message.content, /Check item 0/);
  for (let i = 0; i < 8; i++) assert.equal((await app.settle()).continue, true);
  assert.equal(await app.settle(), undefined);
  assert.equal(app.calls.length, 10);
});

test('selecting a model through the menu confirms the selection', async () => {
  const app = setup();
  await selectModel(app, advisorA);
  assert.ok(app.notices.some((notice) => notice.includes(advisorA.id)));
});

test('advisor can be any configured provider, selected through the menu', async () => {
  const app = setup();
  await selectModel(app, advisorC);
  await app.command('auto on');
  app.plans.push('Check the test matrix.', 'DONE');
  await app.start('Draft the change.');
  assert.equal(await app.settle(), undefined);
  assert.equal(app.calls[0].model, advisorC, 'streamed on a non-OpenRouter provider');
});

test('model selection supports ids that contain slashes', async () => {
  const app = setup();
  await selectModel(app, advisorA);
  await app.command('auto on');
  app.plans.push('Check one.', 'DONE');
  await app.start('Verify the greeting.');
  await app.settle();
  assert.equal(app.calls[0].model, advisorA, 'resolved provider=openrouter, id=example/advisor-a');
});

test('auto on with a task sets the goal and launches with a kickoff', async () => {
  const app = setup();
  await selectModel(app, advisorA);
  app.plans.push('Add a test for the change.');
  await app.command('auto on Build a deterministic greeting and add a unit test for it.');
  assert.equal(app.sent.length, 1);
  assert.match(app.sent[0], /AutoComm advisor suggestion: Add a test for the change\./);
  assert.deepEqual(JSON.parse(app.calls[0].context.messages[0].content), {
    phase: 'kickoff', goal: 'Build a deterministic greeting and add a unit test for it.', latestReply: '', previousAdvice: [], workspaceFiles: [],
  });
});

test('a launched task keeps its own goal across follow-up reviews, not the injected prompt', async () => {
  const app = setup();
  await selectModel(app, advisorA);
  app.plans.push('First milestone.', 'Second milestone.');
  await app.command('auto on Refactor the parser.');
  assert.equal(app.calls[0].context.messages[0].content.includes('Refactor the parser.'), true);
  // The injected user message starts a run; it must not be re-read as a new goal.
  assert.equal(await app.start('AutoComm advisor suggestion: First milestone.'), undefined);
  const result = await app.settle();
  assert.equal(result.continue, true);
  assert.equal(JSON.parse(app.calls[1].context.messages[0].content).goal, 'Refactor the parser.');
});

test('public commands reject removed forms and unknown actions', async () => {
  const app = setup();
  for (const args of ['on', 'off', 'auto', 'model openrouter/example/advisor-a', 'share file.txt']) {
    await app.command(args);
    assert.match(app.notices.at(-1), /^Usage:/);
  }
  assert.equal(await app.command(''), undefined);
  assert.equal(app.sent.length, 0);
});

test('bare /autocomm opens a menu for starting tasks and configuring the advisor', async () => {
  const app = setup();
  await app.command('');
  assert.equal(app.selections.length, 1);
  assert.match(app.selections[0].title, /AutoComm/);
  assert.deepEqual(app.selections[0].choices, [
    'Start auto task',
    'Enable auto mode',
    'Disable auto mode',
    'Change advisor model',
    'Share a file',
    'Unshare a file',
    'Unshare all files',
    'Show status',
  ]);
});

test('choosing Start auto task prompts for the goal and launches a kickoff', async () => {
  const app = setup();
  await selectModel(app, advisorA);
  app.plans.push('Run the test.', 'DONE');
  await menuInput(app, 'Start auto task', 'Greet the reviewer.');
  assert.equal(app.sent.length, 1);
  assert.equal(JSON.parse(app.calls[0].context.messages[0].content).phase, 'kickoff');
  assert.equal(JSON.parse(app.calls[0].context.messages[0].content).goal, 'Greet the reviewer.');
});

test('choosing Show status in the menu routes to the status subcommand', async () => {
  const app = setup();
  app.choose = () => 'Show status';
  await app.command('');
  assert.equal(app.selections.length, 1);
  assert.match(app.notices.at(-1), /AutoComm off \| Advisor: current Pi model \| Phase: idle/);
});
