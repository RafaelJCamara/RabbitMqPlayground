/**
 * The icons of the editor (ADR-0032): paths on a 24 by 24 grid, drawn with a stroke of 2 and round ends, in the colour of the
 * text around them. They are decoration: every control that has one also has a name in words.
 */
export const ICONS = {
  producer: 'M4 12h14 M13 6l6 6-6 6',
  exchange: 'M4 12h6 M10 12c4 0 4-6 8-6 M10 12c4 0 4 6 8 6 M16 3l3 3-3 3 M16 15l3 3-3 3',
  queue: 'M4 8h16v8H4z M9 8v8 M14 8v8',
  consumer: 'M4 13l3-7h10l3 7v5H4z M4 13h5l1 2h4l1-2h5',
  direct: 'M4 12h16 M15 7l5 5-5 5',
  fanout: 'M4 12h6 M10 12l9-6 M10 12h9 M10 12l9 6',
  topic: 'M9 4l-2 16 M17 4l-2 16 M4 9h16 M3 15h16',
  headers: 'M4 6h6 M4 12h6 M4 18h6 M14 6h6 M14 12h6 M14 18h6',
  undo: 'M9 14L4 9l5-5 M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5 M20 9H10a6 6 0 0 0 0 12h3',
  layout: 'M4 5h6v4H4z M14 5h6v4h-6z M9 15h6v4H9z M7 9v3h10V9 M12 12v3',
  'zoom-in': 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M21 21l-4.5-4.5 M11 8v6 M8 11h6',
  'zoom-out': 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M21 21l-4.5-4.5 M8 11h6',
  fit: 'M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v6 M14 11v6',
  plus: 'M12 5v14 M5 12h14',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z',
  monitor: 'M3 5h18v11H3z M8 20h8 M12 16v4',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 11v6 M12 7.5v.5',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M9.5 9.5a2.6 2.6 0 1 1 3.6 2.4c-.7.4-1.1.9-1.1 1.8 M12 17v.5',
  alert: 'M12 3l10 18H2z M12 10v5 M12 18v.5',
  check: 'M5 12l5 5 9-10',
  rename: 'M4 20l4-1 11-11-3-3L5 16z M14 6l3 3',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  close: 'M6 6l12 12 M18 6L6 18',
} as const;

export type IconName = keyof typeof ICONS;
