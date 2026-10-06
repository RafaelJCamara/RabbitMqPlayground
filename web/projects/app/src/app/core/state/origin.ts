/**
 * What started a command (ADR-0031). Every apply says, so that S5's equivalent-command log can write a line for each change that
 * was not typed, and S6 can follow the engine. `gesture` is a pointer on the canvas or in the toolbox, `key` a key,
 * `inspector` a form, `toolbar` a button of the top bar, and `menu` the context menu. The command bar of S5 will be a sixth.
 */
export type CommandOrigin = 'gesture' | 'key' | 'inspector' | 'toolbar' | 'menu';
