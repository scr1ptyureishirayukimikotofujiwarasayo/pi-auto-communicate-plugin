import assert from 'node:assert/strict';
import { test } from 'node:test';
import autocomm from '../extension.ts';

const advisorA = { id: 'example/advisor-a', provider: 'openrouter', maxTokens: 8192 };
const advisorB = { id: 'example/advisor-b', provider: 'openrouter', maxTokens: 8192 };
const advisorC = { id: 'gpt-5.2', provider: 'github-copilot', maxTokens: 8192 };

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
    end: () => events.get('agent_end')({}, ctx),
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
  assert.equal(first.options.maxTokens, 4096);
  assert.equal(first.context.messages.length, 1);
  assert.deepEqual(JSON.parse(first.context.messages[0].content), {
    phase: 'kickoff', goal: 'Verify the greeting.', latestReply: '', previousAdvice: [], workspaceFiles: [],
  });
  assert.equal((await app.settle()).continue, true);
  assert.deepEqual(JSON.parse(app.calls[1].context.messages[0].content).previousAdvice, ['Run the greeting unit test.']);
  await app.end();
  assert.equal(app.events.has('agent_settled'), false, 'stopping is confirmed at agent_end, not agent_settled');
});

test('switches advisor models through the menu between automatic reviews', async () => {
  const app = setup();
  await selectModel(app, advisorA);
  await app.command('auto on');
  app.plans.push('Check one.', 'Check two.');
  await app.start('Review the greeting.');
  assert.equal((await app.settle()).continue, true);
  await selectModel(app, advisorB);
  assert.equal((await app.settle()).continue, true);
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

test('auto mode caps follow-ups and falls back to an ordinary run if kickoff returns DONE', async () => {
  const app = setup();
  await selectModel(app, advisorA);
  await app.command('auto on');
  assert.equal(await app.start('No kickoff needed.'), undefined);
  assert.equal(await app.settle(), undefined, 'a DONE kickoff leaves the original prompt to Pi');
  assert.equal(app.calls.length, 1);
  await app.end();
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
  app.plans.push('Check the test matrix.');
  await app.start('Draft the change.');
  assert.equal((await app.settle()).continue, true);
  assert.equal(app.calls[0].model, advisorC, 'streamed on a non-OpenRouter provider');
});

test('model selection supports ids that contain slashes', async () => {
  const app = setup();
  await selectModel(app, advisorA);
  await app.command('auto on');
  app.plans.push('Check one.');
  await app.start('Verify the greeting.');
  await app.settle();
  assert.equal(app.calls[0].model, advisorA, 'resolved provider=openrouter, id=example/advisor-a');
});

test('a direct task enables auto mode and launches with a kickoff', async () => {
  const app = setup();
  await selectModel(app, advisorA);
  app.plans.push('Add a test for the change.', 'Verify the result.', 'DONE');
  await app.command('Build a deterministic greeting and add a unit test for it.');
  assert.equal(app.sent.length, 1);
  assert.match(app.sent[0], /AutoComm advisor suggestion: Add a test for the change\./);
  assert.deepEqual(JSON.parse(app.calls[0].context.messages[0].content), {
    phase: 'kickoff', goal: 'Build a deterministic greeting and add a unit test for it.', latestReply: '', previousAdvice: [], workspaceFiles: [],
  });
  // The injected user message starts a run; it must not replace the task goal.
  assert.equal(await app.start('AutoComm advisor suggestion: Add a test for the change.'), undefined);
  const result = await app.settle();
  assert.match(result.entries[0].content, /Verify the result\./);
  assert.match(result.entries[0].content, /Work on this milestone only/);
  assert.equal(JSON.parse(app.calls[1].context.messages[0].content).goal, 'Build a deterministic greeting and add a unit test for it.');
});

test('task text that starts with an internal action is still a task', async () => {
  const app = setup();
  await selectModel(app, advisorA);
  const menuCount = app.selections.length;
  app.plans.push('Inspect the domain model.');
  await app.command('model the domain and add tests');
  assert.equal(app.selections.length, menuCount, 'no model-selection menu opens for the task');
  assert.equal(app.sent.length, 1);
  assert.equal(JSON.parse(app.calls[0].context.messages[0].content).goal, 'model the domain and add tests');
});

test('a launched task keeps its own goal across follow-up reviews, not the injected prompt', async () => {
  const app = setup();
  await selectModel(app, advisorA);
  app.plans.push('First milestone.', 'Second milestone.');
  await app.command('Refactor the parser.');
  assert.equal(app.calls[0].context.messages[0].content.includes('Refactor the parser.'), true);
  // The injected user message starts a run; it must not be re-read as a new goal.
  assert.equal(await app.start('AutoComm advisor suggestion: First milestone.'), undefined);
  const result = await app.settle();
  assert.equal(result.continue, true);
  assert.equal(JSON.parse(app.calls[1].context.messages[0].content).goal, 'Refactor the parser.');
});

test('public commands reject combined auto/task forms and invalid lifecycle arguments', async () => {
  const app = setup();
  for (const args of ['auto on Build a greeting', 'auto off Build a greeting', 'auto maybe', 'stop now', 'resume Refactor']) {
    await app.command(args);
    assert.match(app.notices.at(-1), /^Usage:/);
  }
  assert.equal(await app.command(''), undefined);
  assert.equal(app.sent.length, 0);
  assert.equal(app.calls.length, 0);
});

test('bare auto command offers on/off and enabled mode uses the first ordinary prompt', async () => {
  const app = setup();
  await selectModel(app, advisorA);
  app.choose = () => 'Turn auto on';
  await app.command('auto');
  assert.deepEqual(app.selections.at(-1).choices, ['Turn auto on', 'Turn auto off']);
  app.choose = undefined;
  app.plans.push('Inspect the implementation.', 'Run the focused test.', 'DONE');
  const kickoff = await app.start('Fix the greeting.');
  assert.match(kickoff.message.content, /Inspect the implementation\./);
  assert.equal(JSON.parse(app.calls[0].context.messages[0].content).goal, 'Fix the greeting.');
  const checkpoint = await app.settle();
  assert.match(checkpoint.entries[0].content, /Run the focused test\./);
  assert.equal(JSON.parse(app.calls[1].context.messages[0].content).latestReply, 'Pi replied.');
  await app.settle();
  assert.equal(app.calls.length, 3, 'DONE ends the automatic reply loop');
  app.choose = () => 'Turn auto off';
  await app.command('auto');
  await app.start('An ordinary prompt with auto off.');
  assert.equal(app.calls.length, 3);
});

test('bare /autocomm opens only task, model, and lifecycle controls', async () => {
  const app = setup();
  await app.command('');
  assert.equal(app.selections.length, 1);
  assert.match(app.selections[0].title, /AutoComm/);
  assert.deepEqual(app.selections[0].choices, [
    'Start auto task',
    'Change advisor model',
    'Stop current review',
    'Resume review',
    'Turn auto off',
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

test('DONE and failed reviews still settle, and every cycle is cleaned up at agent_end', async () => {
  const app = setup();
  await selectModel(app, advisorA);
  await app.command('auto on');
  app.plans.push('Start checking.', 'Check once.');
  await app.start('Check the result.');
  assert.equal((await app.settle()).continue, true);
  const done = await app.settle();
  assert.equal(done.continue, true);
  assert.equal(done.entries.length, 0);
  assert.equal(await app.settle(), undefined, 'DONE prevents another advisor call in this cycle');
  await app.end();
  await app.start('A fresh goal.');
  assert.equal(app.calls.length, 4, 'agent_end permits a new goal');
});

test('stop cancels the active review but leaves auto mode enabled for a new prompt', async () => {
  const app = setup();
  await selectModel(app, advisorA);
  await app.command('auto on');
  app.plans.push(() => new Promise(() => {}));
  const pending = app.start('Review this goal.');
  const { signal } = app.calls[0].options;
  await app.command('stop');
  assert.equal(signal.aborted, true);
  assert.equal(await pending, undefined);
  app.plans.push('Fresh start.');
  assert.match((await app.start('Another goal.')).message.content, /Fresh start/);
  await app.command('auto off');
});

test('resume starts an explicit new review cycle without changing Pi model', async () => {
  const app = setup();
  await selectModel(app, advisorA);
  await app.command('auto on');
  await app.start('Original goal.');
  await app.command('stop');
  app.input = 'Resume the original goal.';
  app.plans.push('Check the current implementation.');
  await app.command('resume');
  assert.equal(app.sent.length, 1);
  assert.match(app.sent[0], /Check the current implementation/);
  const request = JSON.parse(app.calls[1].context.messages[0].content);
  assert.equal(request.phase, 'review');
  assert.equal(request.goal, 'Resume the original goal.');
  assert.equal(app.calls[0].model, advisorA);
});

test('incomplete advisor replies report token limits and provider errors without injecting advice', async () => {
  const app = setup();
  await selectModel(app, advisorA);
  await app.command('auto on');
  app.plans.push(() => Promise.resolve({ stopReason: 'length', content: [] }));
  assert.equal(await app.start('Check token handling.'), undefined);
  assert.match(app.notices.at(-1), /token limit/);
  assert.equal(app.sent.length, 0);

  app.plans.push(() => Promise.resolve({ stopReason: 'error', errorMessage: 'Provider unavailable', content: [] }));
  assert.equal(await app.start('Check error handling.'), undefined);
  assert.match(app.notices.at(-1), /Provider unavailable/);
  assert.equal(app.sent.length, 0);
});

test('status remains available as an explicit command', async () => {
  const app = setup();
  await app.command('status');
  assert.match(app.notices.at(-1), /AutoComm off \| Advisor: current Pi model \| Phase: idle/);
});
