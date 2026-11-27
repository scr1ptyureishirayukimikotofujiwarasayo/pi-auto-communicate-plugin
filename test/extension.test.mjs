import assert from 'node:assert/strict';
import { test } from 'node:test';
import autocomm from '../extension.ts';

const advisorA = { id: 'example/advisor-a', provider: 'openrouter' };
const advisorB = { id: 'example/advisor-b', provider: 'openrouter' };

function setup() {
  const events = new Map();
  const calls = [];
  const plans = [];
  let command;
  const ctx = {
    ui: { setStatus() {}, notify() {} },
    hasPendingMessages: () => false,
    modelRegistry: {
      find: (provider, id) => [advisorA, advisorB].find(m => m.provider === provider && m.id === id),
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
    registerCommand(name, registration) {
      assert.equal(name, 'autocomm');
      command = registration.handler;
    },
  });

  return {
    calls,
    plans,
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
    goal: 'Verify the greeting.', latestReply: 'Pi replied.', previousAdvice: [],
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
