import { ansiToHtml, ansiToMarkers } from './ansi';

const ESC = '\x1b';
const BOLD = `${ESC}[1m`;
const RESET = `${ESC}[0m`;

describe('ansiToHtml', () => {
  it('returns escaped plain text unchanged when there are no SGR codes', () => {
    expect(ansiToHtml('plain <b>text</b>')).toBe('plain &lt;b&gt;text&lt;/b&gt;');
  });

  it('wraps bold (SGR 1) text in an ansi-bold span', () => {
    expect(ansiToHtml(`${BOLD}The Featureless Space${RESET}`)).toBe(
      '<span class="ansi-bold">The Featureless Space</span>'
    );
  });

  it('closes styling at the trailing reset even without more text after it', () => {
    expect(ansiToHtml(`${BOLD}bold${RESET}plain`)).toBe('<span class="ansi-bold">bold</span>plain');
  });

  it('stacks multiple active styles into one class list', () => {
    // SGR 1 (bold) then SGR 31 (red) without a reset in between - both stay active.
    expect(ansiToHtml(`${ESC}[1m${ESC}[31murgent${RESET}`)).toBe(
      '<span class="ansi-bold ansi-red">urgent</span>'
    );
  });

  it('SGR 39 (default foreground) pops only the color, leaving other active styles', () => {
    expect(ansiToHtml(`${ESC}[1m${ESC}[31mred bold${ESC}[39mjust bold${RESET}`)).toBe(
      '<span class="ansi-bold ansi-red">red bold</span><span class="ansi-bold">just bold</span>'
    );
  });

  it('maps a known dgdebug 24-bit RGB triplet to its named color class', () => {
    expect(ansiToHtml(`${ESC}[38;2;223;32;80mred${RESET}`)).toBe('<span class="ansi-red">red</span>');
  });

  it('falls back to an inline hex style for an unrecognized RGB triplet', () => {
    expect(ansiToHtml(`${ESC}[38;2;10;20;30mcustom${RESET}`)).toBe(
      '<span style="color:#0a141e">custom</span>'
    );
  });

  it('escapes HTML-significant characters within styled text', () => {
    expect(ansiToHtml(`${BOLD}<b>&${RESET}`)).toBe('<span class="ansi-bold">&lt;b&gt;&amp;</span>');
  });
});

describe('ansiToMarkers', () => {
  it('returns plain text unchanged when there are no SGR codes', () => {
    expect(ansiToMarkers('plain text')).toBe('plain text');
  });

  it('wraps bold text in [B]...[/B] pseudo-markers', () => {
    expect(ansiToMarkers(`${BOLD}The Featureless Space${RESET}`)).toBe('[B]The Featureless Space[/B]');
  });

  it('emits nested markers in push order, closed in reverse on reset', () => {
    expect(ansiToMarkers(`${ESC}[1m${ESC}[31murgent${RESET}`)).toBe('[B][RED]urgent[/RED][/B]');
  });

  it('SGR 39 closes only the color marker, not other active styles', () => {
    expect(ansiToMarkers(`${ESC}[1m${ESC}[31mred bold${ESC}[39mjust bold${RESET}`)).toBe(
      '[B][RED]red bold[/RED]just bold[/B]'
    );
  });

  it('closes any still-open markers at the end of the text even without an explicit reset', () => {
    expect(ansiToMarkers(`${BOLD}unterminated`)).toBe('[B]unterminated[/B]');
  });
});
