import { afterEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../../../src/domain/game/game.aggregate.js';
import { ROLE_BIT } from '../../../src/domain/roles/role.js';
import { generateAiGazette } from '../../../src/domain/gazette/ai-gazette-generator.js';

function dealtGame(): Game {
  const game = new Game({ chatId: 1n, mode: 'Normal', minPlayers: 5 });
  game.addPlayer(1n, 'Wolfy');
  game.addPlayer(2n, 'Villager2');
  game.addPlayer(3n, 'Villager3');
  game.addPlayer(4n, 'Villager4');
  game.addPlayer(5n, 'Villager5');
  game.start();
  for (const p of game.players) {
    p.role = ROLE_BIT.Villager;
    p.team = 'Village';
  }
  game.players[0]!.role = ROLE_BIT.Wolf;
  game.players[0]!.team = 'Wolf';
  game.weather = 'FullMoon';
  game.dayNumber = 2;
  game.winningTeam = 'Village';
  game.voteLog.push({ day: 1, voterId: 2n, targetId: 1n }, { day: 1, voterId: 3n, targetId: null });
  return game;
}

describe('generateAiGazette', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null without ever calling fetch when no API key is configured', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await generateAiGazette(dealtGame(), [], 'fr', undefined);

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns null when the Gemini API responds with a non-ok status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false }) as Response),
    );

    const result = await generateAiGazette(dealtGame(), [], 'fr', 'fake-key');

    expect(result).toBeNull();
  });

  it('returns null when the network call throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    const result = await generateAiGazette(dealtGame(), [], 'fr', 'fake-key');

    expect(result).toBeNull();
  });

  it('returns null when the response has no usable text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => ({ ok: true, json: async () => ({ candidates: [] }) }) as unknown as Response,
      ),
    );

    const result = await generateAiGazette(dealtGame(), [], 'fr', 'fake-key');

    expect(result).toBeNull();
  });

  it('returns the parsed story on success, and sends a prompt fencing player-name data with an anti-self-reference rule', async () => {
    const fetchSpy = vi.fn(
      async (_url: string | URL, _init?: RequestInit) =>
        ({
          ok: true,
          json: async () => ({
            candidates: [
              { content: { parts: [{ text: '  Une nuit mémorable à Thiercelieux...  ' }] } },
            ],
          }),
        }) as unknown as Response,
    );
    vi.stubGlobal('fetch', fetchSpy);

    const game = dealtGame();
    const result = await generateAiGazette(game, [], 'fr', 'fake-key');

    expect(result).not.toBeNull();
    expect(result!.title).toContain('GAZETTE');
    expect(result!.lines).toEqual(['Une nuit mémorable à Thiercelieux...']);

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain('fake-key');
    const body = JSON.parse((init as RequestInit).body as string);
    const prompt = body.contents[0].parts[0].text as string;

    // Real game data actually reached the prompt.
    expect(prompt).toContain('Wolfy');
    expect(prompt).toContain('Villager2');
    // The explicit never-mention-AI safeguard is present in every prompt sent.
    expect(prompt).toMatch(/IA|intelligence artificielle/);
    expect(prompt).toContain('Gemini');
  });

  it('never leaks the word "AI"/model name into the returned story text itself (only into the instruction, not the output)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            json: async () => ({
              candidates: [
                {
                  content: {
                    parts: [{ text: 'Un récit théâtral sans aucune mention technique.' }],
                  },
                },
              ],
            }),
          }) as unknown as Response,
      ),
    );

    const result = await generateAiGazette(dealtGame(), [], 'fr', 'fake-key');

    expect(result!.lines[0]).not.toMatch(/\bIA\b|intelligence artificielle|Gemini|généré/i);
  });

  it('escapes any stray HTML the model produces instead of passing it through to Telegram', async () => {
    // Regression test: an unescaped `<b>` (matched or not) sent with parse_mode 'HTML' either
    // renders wrong or gets the whole message hard-rejected by Telegram - and that rejection used
    // to vanish silently (see `GameLoop.sendRaw()`), so a game's Gazette would just never arrive
    // with no trace anywhere. The model was previously (wrongly) invited to use <b>/<i> tags at
    // all; now nothing it writes should ever reach Telegram unescaped.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            json: async () => ({
              candidates: [
                {
                  content: {
                    parts: [{ text: '<b>Alice</b> a survécu <script>alert(1)</script> & gagné.' }],
                  },
                },
              ],
            }),
          }) as unknown as Response,
      ),
    );

    const result = await generateAiGazette(dealtGame(), [], 'fr', 'fake-key');

    expect(result!.lines[0]).not.toContain('<b>');
    expect(result!.lines[0]).not.toContain('<script>');
    expect(result!.lines[0]).toContain('&lt;b&gt;');
    expect(result!.lines[0]).toContain('&amp;');
  });

  it('truncates a runaway response instead of risking a hard rejection for exceeding the 4096-char message limit', async () => {
    const hugeText = 'a'.repeat(5000);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            json: async () => ({ candidates: [{ content: { parts: [{ text: hugeText }] } }] }),
          }) as unknown as Response,
      ),
    );

    const result = await generateAiGazette(dealtGame(), [], 'fr', 'fake-key');

    expect(result!.lines[0]!.length).toBeLessThan(3600);
  });

  it('falls back to null when the response was cut short mid-generation (finishReason !== STOP)', async () => {
    // Regression test: Gemini 2.5 Flash can hit its token cap mid-story and return whatever text
    // it had written so far, with finishReason: 'MAX_TOKENS' - a real story genuinely observed
    // cutting off mid-sentence ("...sur le"). Showing that half-written text is worse than falling
    // back to the plain template, so a non-STOP finish is treated the same as no text at all.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            json: async () => ({
              candidates: [
                {
                  content: { parts: [{ text: 'La tempête faisait rage... sur le' }] },
                  finishReason: 'MAX_TOKENS',
                },
              ],
            }),
          }) as unknown as Response,
      ),
    );

    const result = await generateAiGazette(dealtGame(), [], 'fr', 'fake-key');

    expect(result).toBeNull();
  });

  it('accepts a response whose finishReason is explicitly STOP', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            json: async () => ({
              candidates: [
                {
                  content: { parts: [{ text: 'Une histoire complète, du début à la fin.' }] },
                  finishReason: 'STOP',
                },
              ],
            }),
          }) as unknown as Response,
      ),
    );

    const result = await generateAiGazette(dealtGame(), [], 'fr', 'fake-key');

    expect(result).not.toBeNull();
  });

  it('disables thinking and requests a generous token budget, so the story is never starved by internal reasoning', async () => {
    const fetchSpy = vi.fn(
      async (_url: string | URL, _init?: RequestInit) =>
        ({
          ok: true,
          json: async () => ({
            candidates: [
              { content: { parts: [{ text: 'Un récit complet.' }] }, finishReason: 'STOP' },
            ],
          }),
        }) as unknown as Response,
    );
    vi.stubGlobal('fetch', fetchSpy);

    await generateAiGazette(dealtGame(), [], 'fr', 'fake-key');

    const [, init] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(body.generationConfig.maxOutputTokens).toBeGreaterThanOrEqual(1024);
  });
});
