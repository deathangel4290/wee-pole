'use strict';

/*
 * Achievements. Each test() runs after every finished game or daily update and
 * receives the event plus a context with stats, bests, streak and today's dailies.
 *
 * Game event:  { game, result, score, level, roulette }
 * Daily event: { daily, entry, justCompleted }
 */
(() => {
  const won = (game, level) => (e) => e.game === game && e.result === 'win' && (!level || e.level === level);

  const LIST = [
    // Getting started
    ['first-game', '🎮', 'Warm-up', 'Finish your first game.', (e, c) => c.totals().played >= 1],
    ['sampler', '🧭', 'Sampler', 'Play every game in the box.', (e, c) => c.games.every((g) => c.stats(g.id).played > 0)],
    ['regular', '📈', 'Regular', 'Finish 50 games.', (e, c) => c.totals().played >= 50],
    ['marathon', '🏃', 'Marathon', 'Finish 250 games.', (e, c) => c.totals().played >= 250],

    // Bots
    ['ttt-hard', '🤝', 'Unbeatable?', 'Hold the hard Tic-Tac-Toe bot to a draw.',
      (e) => e.game === 'tictactoe' && e.result === 'draw' && e.level === 'hard'],
    ['c4-hard', '🔴', 'Four Star', 'Beat the hard Connect 4 bot.', won('connect4', 'hard')],
    ['reversi-hard', '⚫', 'Corner Office', 'Beat the hard Reversi bot.', won('reversi', 'hard')],
    ['reversi-landslide', '🌊', 'Landslide', 'Win Reversi against a bot by 40+ discs.',
      (e) => won('reversi')(e) && e.level !== '2p' && e.score >= 40],
    ['checkers-hard', '👑', 'Crowned', 'Beat the hard Checkers bot.', won('checkers', 'hard')],
    ['chess-win', '♞', 'Opening Night', 'Beat the chess bot on any level.', (e) => won('chess')(e) && e.level !== '2p'],
    ['chess-hard', '♛', 'Grandmaster-ish', 'Beat the hard chess bot.', won('chess', 'hard')],
    ['chess-quick', '⚡', 'Blitzed', 'Checkmate the chess bot in 25 moves or fewer.',
      (e) => won('chess')(e) && e.level !== '2p' && e.score <= 25],

    // Solo games
    ['2048', '🔢', '2048!', 'Make the 2048 tile.', won('2048')],
    ['2048-10k', '💯', 'High Roller', 'Score 10,000 in 2048.', (e) => e.game === '2048' && e.score >= 10000],
    ['sweep-hard', '💣', 'Bomb Squad', 'Clear a hard Minesweeper board.', won('minesweeper', 'hard')],
    ['sweep-fast', '⏱️', 'Speedsweeper', 'Clear an easy Minesweeper board in under 20 seconds.',
      (e) => won('minesweeper', 'easy')(e) && e.score < 20],
    ['snake-20', '🐍', 'Long Boi', 'Score 20 in Snake.', (e) => e.game === 'snake' && e.score >= 20],
    ['snake-50', '🐉', 'Dragon', 'Score 50 in Snake.', (e) => e.game === 'snake' && e.score >= 50],

    // Roulette
    ['roulette', '🎰', 'Spin Doctor', 'Finish a game picked by the roulette.', (e) => !!e.roulette],
    ['roulette-10', '🎲', 'Gambler', 'Finish 10 roulette games.', (e, c) => (c.counters.roulette || 0) >= 10],

    // Dailies
    ['daily-first', '☀️', 'Daily Driver', 'Complete a daily challenge.', (e) => !!e.justCompleted],
    ['daily-all', '🌞', 'Clean Sweep', 'Complete all three daily challenges in one day.',
      (e, c) => c.dailies.length > 0 && c.dailies.every((d) => c.today[d.kind] && c.today[d.kind].done)],
    ['puzzle-first-try', '🧩', 'Sharp Eye', 'Solve the daily puzzle on your first try.',
      (e) => e.daily === 'puzzle' && e.justCompleted && e.entry.tries === 1],
    ['streak-3', '🔥', 'On Fire', 'Keep a 3-day daily streak.', (e, c) => c.streak() >= 3],
    ['streak-7', '📆', 'Week Warrior', 'Keep a 7-day daily streak.', (e, c) => c.streak() >= 7],
  ];

  for (const [id, icon, name, desc, test] of LIST) BB.defineAchievement({ id, icon, name, desc, test });
})();
